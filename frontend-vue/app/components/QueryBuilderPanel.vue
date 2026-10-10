<script setup lang="ts">
import {
	autocompletion,
	type Completion,
	type CompletionContext,
	type CompletionResult,
	completionKeymap,
} from '@codemirror/autocomplete'
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
} from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import {
	bracketMatching,
	defaultHighlightStyle,
	indentOnInput,
	syntaxHighlighting,
} from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import {
	EditorView,
	keymap,
	lineNumbers,
	placeholder as cmPlaceholder,
} from '@codemirror/view'
import { useColorMode } from '@vueuse/core'
import type { SchemaSummary } from '../build/composables/useDatabaseSchemas'
import {
	buildCompletionIndex,
	fieldsAt,
	INSTANCE_METHODS,
	QUERY_METHODS,
	SCHEMA_METHODS,
} from '../build/query/completion'
import { targetFromSource } from '../build/query/target'
import { tableAccess } from '../build/utils/databaseLinks'

// The query editor (D-12): AQL with completion of the workspace's own
// schemas, tables and columns, snippets to insert at
// the cursor, and the cursor position.

interface Props {
	modelValue: string
	executing?: boolean
	// Drives the schema-aware autocomplete (table/field names + the query DSL).
	schemas?: SchemaSummary[]
	/** The saved query open in the editor, if any. */
	savedName?: string
	savedShared?: boolean
	/** Whether the editor differs from the saved query it opened. */
	edited?: boolean
}

const props = withDefaults(defineProps<Props>(), {
	executing: false,
	schemas: () => [],
	savedName: undefined,
	savedShared: false,
	edited: false,
})

const emit = defineEmits<{
	'update:modelValue': [value: string]
	execute: []
	save: []
	new: []
}>()

const { t } = useI18n()

const internalValue = computed<string>({
	get: () => props.modelValue,
	set: (value) => emit('update:modelValue', value),
})

// The placeholder starts from a table of the workspace, not a made-up one.
const placeholderExample = computed(() => {
	const schema = props.schemas.find((candidate) => candidate.tables.length > 0)
	const table = schema?.tables[0]?.name
	return schema && table
		? `${tableAccess({ schema: schema.id, table })}.slice(0, 10)`
		: 'schemas.<schema>.instance().table("<table>").slice(0, 10)'
})

interface Snippet {
	label: string
	insert: string
}

const SNIPPETS: Snippet[] = [
	{ label: 'table()', insert: '.table("")' },
	{ label: 'filter()', insert: '.filter((row) => row.key("").eq(""))' },
	{ label: 'orderBy()', insert: '.orderBy("", "desc")' },
	{ label: 'slice()', insert: '.slice(0, 50)' },
	{ label: 'count()', insert: '.count()' },
	{ label: 'get(id)', insert: '.get("")' },
]

const cursor = ref({ line: 1, column: 1 })

function canExecute(): boolean {
	return Boolean(internalValue.value.trim()) && !props.executing
}

// Light tidy: strip trailing whitespace and surrounding blank lines.
function runFormat() {
	internalValue.value = internalValue.value
		.split('\n')
		.map((line) => line.replace(/\s+$/, ''))
		.join('\n')
		.replace(/^\n+/, '')
		.replace(/\n+$/, '')
}

// --- autocomplete -----------------------------------------------------------
// The DSL is a fluent chain — `schemas.<id>.instance().table("…").slice(…)` — so
// completions are offered by position in that chain rather than as one flat list.

interface CompletionItem {
	label: string
	type: string
	detail?: string
	// What is actually inserted, when it differs from the label: a string (e.g.
	// auto-quoting a table name) or a function (e.g. rewriting `schemas.<id>` to
	// bracket form for ids that aren't valid identifiers).
	apply?:
		| string
		| ((
				view: EditorView,
				completion: Completion,
				from: number,
				to: number,
		  ) => void)
}

const opt = (label: string, type: string, detail?: string): CompletionItem => ({
	label,
	type,
	detail,
})

// Schema-derived names, indexed per schema and per table so completions are
// scoped to the chain's own schema and table. Rebuilt whenever the live schema
// list changes; the completion source reads `.value` lazily, so no editor
// reconfigure is needed.
const completionData = computed(() => buildCompletionIndex(props.schemas ?? []))

// How far back the chain the cursor is in is read: a long multi-line chain
// still names its schema, instance and table.
const CHAIN_WINDOW = 2000

// The schema the chain before the cursor names: `schemas.demo` or
// `schemas["dms-core"]`. Scopes table completions.
function currentSchemaId(before: string): string | null {
	return targetFromSource(before).schema ?? null
}

function listFor(
	map: Record<string, string[]>,
	schemaId: string | null,
	fallback: string[],
): string[] {
	return (schemaId && map[schemaId]) || fallback
}

function chainText(ctx: CompletionContext): string {
	return ctx.state.sliceDoc(Math.max(0, ctx.pos - CHAIN_WINDOW), ctx.pos)
}

function completionSource(ctx: CompletionContext): CompletionResult | null {
	const data = completionData.value
	// A bounded look-behind window covers multi-line chains without scanning the
	// whole document on every keystroke.
	const before = ctx.state.sliceDoc(Math.max(0, ctx.pos - 240), ctx.pos)

	// `instance(<id>)` argument → that schema's instance ids (+ CROSS_INSTANCE).
	// Acts as parameter help: it surfaces what instance() accepts. Quote-aware.
	const inInstance =
		/(?:^|[^\w$.])schemas\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["'`]([\w$-]+)["'`]\s*\])\s*\.\s*instance\(\s*(["'`])?([\w$-]*)$/.exec(
			before,
		)
	if (inInstance) {
		const schemaId = inInstance[1] ?? inInstance[2] ?? ''
		const quote = inInstance[3]
		const typed = inInstance[4] ?? ''
		const options: CompletionItem[] = (
			data.instancesBySchema[schemaId] ?? []
		).map((id) => ({
			label: id,
			type: 'enum',
			detail: 'instance id',
			apply: quote ? id : `"${id}"`,
		}))
		// CROSS_INSTANCE is a bare identifier, so only when not inside a quote.
		if (!quote) {
			options.push({
				label: 'CROSS_INSTANCE',
				type: 'constant',
				detail: 'all instances (read-only)',
			})
		}
		if (!options.length) return null
		return { from: ctx.pos - typed.length, validFor: /[\w$-]*/, options }
	}
	// Schema id inside bracket access: `schemas["…`.
	const inSchemaBracket = /schemas\s*\[\s*["'`]([\w$-]*)$/.exec(before)
	if (inSchemaBracket) {
		const typed = inSchemaBracket[1] ?? ''
		return {
			from: ctx.pos - typed.length,
			validFor: /[\w$-]*/,
			options: data.schemaIds.map((id) => opt(id, 'namespace', 'schema')),
		}
	}
	// `table(<name>)` argument → that schema's table names. Quote-aware.
	const inTable = /\.table\(\s*(["'`])?([\w$-]*)$/.exec(before)
	if (inTable) {
		const quote = inTable[1]
		const typed = inTable[2] ?? ''
		const schemaId = currentSchemaId(before)
		const tables = listFor(data.tablesBySchema, schemaId, data.allTables)
		return {
			from: ctx.pos - typed.length,
			validFor: /[\w$-]*/,
			options: tables.map((name) => ({
				label: name,
				type: 'class',
				detail: 'table',
				apply: quote ? name : `"${name}"`,
			})),
		}
	}
	// Quoted field name inside a field selector (`pluck` / `orderBy` / `key`):
	// the fields of the chain's table.
	const inField = /\.(?:pluck|orderBy|key)\([^)]*["'`]([\w$]*)$/.exec(before)
	if (inField) {
		const typed = inField[1] ?? ''
		const fields = fieldsAt(data, targetFromSource(chainText(ctx)))
		return {
			from: ctx.pos - typed.length,
			validFor: /[\w$]*/,
			options: fields.map((name) => opt(name, 'property', 'field')),
		}
	}

	// Member access / bare identifier.
	const typed = before.match(/[\w$]*$/)?.[0] ?? ''
	const upto = before.slice(0, before.length - typed.length)
	const from = ctx.pos - typed.length

	if (upto.endsWith('.')) {
		const chain = upto.slice(0, -1).trimEnd()
		if (/(?:^|[^\w$.])schemas$/.test(chain)) {
			// `schemas.` → schema ids. Ids that aren't valid identifiers rewrite the
			// dot to bracket form (`schemas["dms-core"]`).
			return {
				from,
				validFor: /[\w$]*/,
				options: data.schemaIds.map((id) => {
					if (/^[A-Z_$][\w$]*$/i.test(id)) {
						return opt(id, 'namespace', 'schema')
					}
					return {
						label: id,
						type: 'namespace',
						detail: 'schema',
						apply: (view, _completion, fromPos, toPos) =>
							view.dispatch({
								changes: {
									from: fromPos - 1,
									to: toPos,
									insert: `[${JSON.stringify(id)}]`,
								},
							}),
					}
				}),
			}
		}
		if (
			/(?:^|[^\w$.])schemas\s*(?:\.\s*[A-Za-z_$][\w$]*|\[\s*["'`][\w$-]+["'`]\s*\])$/.test(
				chain,
			)
		) {
			// `schemas.<id>.` / `schemas["<id>"].` → Schema methods
			return {
				from,
				validFor: /[\w$]*/,
				options: SCHEMA_METHODS.map((m) => opt(m, 'method', 'Schema')),
			}
		}
		if (chain.endsWith(')')) {
			// A completed call → its result's methods.
			const options = /\binstance\s*\([^()]*\)$/.test(chain)
				? INSTANCE_METHODS.map((m) => opt(m, 'method', 'SchemaInstance'))
				: QUERY_METHODS.map((m) => opt(m, 'method', 'Query'))
			return { from, validFor: /[\w$]*/, options }
		}
		// A `.` after a bare, uncalled method (e.g. `…instance.`) is not a DSL step.
		return null
	}

	// Top level: the entry point only.
	if (!typed && !ctx.explicit) return null
	return {
		from,
		validFor: /[\w$]*/,
		options: [opt('schemas', 'variable', 'root')],
	}
}

// --- editor -----------------------------------------------------------------
const editorContainer = ref<HTMLElement | null>(null)
let view: EditorView | null = null
const themeCompartment = new Compartment()
const placeholderCompartment = new Compartment()
const colorMode = useColorMode()

// Transparent surfaces so the editor blends into the DmsCard (bg-default).
const baseTheme = EditorView.theme({
	'&': { backgroundColor: 'transparent', height: '100%', fontSize: '13px' },
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': {
		fontFamily:
			"ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
		lineHeight: '1.6',
	},
	'.cm-content': { padding: '12px 0' },
	'.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
	'.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
})

function themeExtension() {
	return colorMode.value === 'dark'
		? oneDark
		: syntaxHighlighting(defaultHighlightStyle, { fallback: true })
}

onMounted(() => {
	if (!editorContainer.value) return
	const state = EditorState.create({
		doc: internalValue.value,
		extensions: [
			lineNumbers(),
			history(),
			bracketMatching(),
			indentOnInput(),
			javascript({ typescript: true }),
			autocompletion({ override: [completionSource], activateOnTyping: true }),
			placeholderCompartment.of(cmPlaceholder(placeholderExample.value)),
			EditorView.lineWrapping,
			EditorView.contentAttributes.of({
				'aria-label': t('dms_database.query.editor.aria_label'),
			}),
			keymap.of([
				{
					key: 'Mod-Enter',
					preventDefault: true,
					run: () => {
						if (canExecute()) emit('execute')
						return true
					},
				},
				{
					key: 'Mod-s',
					preventDefault: true,
					run: () => {
						if (internalValue.value.trim()) emit('save')
						return true
					},
				},
				indentWithTab,
				...completionKeymap,
				...defaultKeymap,
				...historyKeymap,
			]),
			themeCompartment.of(themeExtension()),
			baseTheme,
			EditorView.updateListener.of((update) => {
				if (update.selectionSet || update.docChanged) {
					const head = update.state.selection.main.head
					const line = update.state.doc.lineAt(head)
					cursor.value = { line: line.number, column: head - line.from + 1 }
				}
				if (!update.docChanged) return
				const text = update.state.doc.toString()
				if (text !== props.modelValue) emit('update:modelValue', text)
			}),
		],
	})
	view = new EditorView({ state, parent: editorContainer.value })
})

// External edits (history load, format, clear) → push into the editor.
watch(
	() => props.modelValue,
	(value) => {
		if (view && value !== view.state.doc.toString()) {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: value },
			})
		}
	},
)

watch(placeholderExample, (example) => {
	view?.dispatch({
		effects: placeholderCompartment.reconfigure(cmPlaceholder(example)),
	})
})

// Swap the syntax theme when the app toggles light/dark.
watch(
	() => colorMode.value,
	() => {
		view?.dispatch({
			effects: themeCompartment.reconfigure(themeExtension()),
		})
	},
)

onBeforeUnmount(() => {
	view?.destroy()
	view = null
})

// Inserts a snippet at the cursor, the cursor landing inside its first quotes.
function insertSnippet(snippet: Snippet) {
	if (!view) return
	const { from, to } = view.state.selection.main
	const quote = snippet.insert.indexOf('""')
	const anchor = from + (quote >= 0 ? quote + 1 : snippet.insert.length)
	view.dispatch({
		changes: { from, to, insert: snippet.insert },
		selection: { anchor },
	})
	view.focus()
}

defineExpose({ focus: () => view?.focus() })
</script>

<template>
	<DmsCard :padded="false" class="overflow-hidden">
		<div
			class="border-default flex flex-wrap items-center gap-2 border-b px-3.5 py-2.5"
		>
			<span
				v-if="savedName"
				class="text-highlighted flex min-w-0 items-center gap-1.5 text-sm font-medium"
			>
				<UIcon name="i-ph-star-fill" class="text-warning size-4 shrink-0" />
				<span class="truncate">{{ savedName }}</span>
				<UBadge v-if="savedShared" color="neutral" variant="outline" size="sm">
					{{ t('dms_database.query.editor.shared') }}
				</UBadge>
				<span v-if="edited" class="text-dimmed text-xs font-normal">
					· {{ t('dms_database.query.editor.edited') }}
				</span>
			</span>
			<span v-else class="text-muted text-sm">
				{{ t('dms_database.query.editor.untitled') }}
			</span>
			<span class="flex-1" />
			<UTooltip :text="t('dms_database.query.editor.new_hint')">
				<UButton
					size="sm"
					color="neutral"
					variant="ghost"
					icon="i-ph-plus"
					:label="t('dms_database.query.editor.new')"
					@click="emit('new')"
				/>
			</UTooltip>
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-ph-magic-wand"
				:label="t('dms_database.query.editor.format')"
				:disabled="!internalValue.trim()"
				@click="runFormat"
			/>
			<UButton
				size="sm"
				color="neutral"
				variant="outline"
				icon="i-ph-floppy-disk"
				:disabled="!internalValue.trim()"
				@click="emit('save')"
			>
				{{ t('dms_database.query.editor.save') }}
				<!-- `meta` and `ctrl` read ⌘ or Ctrl from the browser, which the
				     server cannot tell: rendered on the client only. -->
				<DmsClientOnly>
					<UKbd value="meta" size="sm" class="ml-1" />
				</DmsClientOnly>
				<UKbd value="s" size="sm" />
			</UButton>
			<UButton
				size="sm"
				icon="i-ph-play"
				:loading="executing"
				:disabled="!internalValue.trim() || executing"
				@click="emit('execute')"
			>
				{{ t('dms_database.query.editor.run') }}
				<DmsClientOnly>
					<UKbd value="meta" size="sm" class="ml-1" />
				</DmsClientOnly>
				<UKbd value="enter" size="sm" />
			</UButton>
		</div>

		<!-- CodeMirror mounts here on the client. -->
		<div
			ref="editorContainer"
			class="bg-default text-toned h-60 overflow-auto"
		/>

		<div
			class="border-default text-dimmed flex flex-wrap items-center gap-2 border-t px-3.5 py-2 text-[11.5px]"
		>
			<DmsEyebrow :label="t('dms_database.query.editor.insert')" />
			<button
				v-for="snippet in SNIPPETS"
				:key="snippet.label"
				type="button"
				class="border-default bg-elevated text-toned hover:border-primary hover:text-highlighted rounded border px-1.5 py-0.5 font-mono text-[11px]"
				@click="insertSnippet(snippet)"
			>
				{{ snippet.label }}
			</button>
			<span class="ml-auto flex items-center gap-1">
				<DmsClientOnly>
					<UKbd value="ctrl" size="sm" />
				</DmsClientOnly>
				<UKbd value="space" size="sm" />
				{{ t('dms_database.query.editor.complete') }}
			</span>
			<span class="font-mono">
				{{
					t('dms_database.query.editor.position', {
						line: cursor.line,
						column: cursor.column,
					})
				}}
			</span>
		</div>
	</DmsCard>
</template>

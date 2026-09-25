<script setup lang="ts">
import {
	autocompletion,
	type Completion,
	type CompletionContext,
	type CompletionResult,
	completionKeymap,
} from "@codemirror/autocomplete";
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
} from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import {
	bracketMatching,
	defaultHighlightStyle,
	indentOnInput,
	syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
	EditorView,
	keymap,
	lineNumbers,
	placeholder as cmPlaceholder,
} from "@codemirror/view";
import { useColorMode } from "@vueuse/core";
import type { SchemaSummary } from "../composables/useDatabaseSchemas";
import type { QueryLanguage } from "../composables/useQueryStore";

interface Props {
	modelValue: string;
	language: QueryLanguage;
	executing?: boolean;
	// Drives the schema-aware autocomplete (table/field names + the query DSL).
	schemas?: SchemaSummary[];
}

const props = withDefaults(defineProps<Props>(), {
	executing: false,
	schemas: () => [],
});

const emit = defineEmits<{
	"update:modelValue": [value: string];
	"update:language": [value: QueryLanguage];
	execute: [];
	save: [];
}>();

// Static code example for the builder DSL, used as the editor placeholder and the
// footer hint (not translatable — the angle-bracket-free call trips no i18n guard).
const BUILDER_EXAMPLE = 'schemas.shop.instance().table("users").slice(0, 10)';

const internalValue = computed<string>({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});

const languageOptions = [{ label: "AQL", value: "aql" as const }];

const internalLanguage = computed<QueryLanguage>({
	get: () => props.language,
	set: (value) => emit("update:language", value),
});

function canExecute(): boolean {
	return Boolean(internalValue.value.trim()) && !props.executing;
}

// Light tidy: strip trailing whitespace and surrounding blank lines.
function runFormat() {
	internalValue.value = internalValue.value
		.split("\n")
		.map((line) => line.replace(/\s+$/, ""))
		.join("\n")
		.replace(/^\n+/, "")
		.replace(/\n+$/, "");
}

// --- autocomplete -----------------------------------------------------------
// The DSL is a fluent chain — `schemas.<id>.instance().table("…").slice(…)` — so
// completions are offered by position in that chain rather than as one flat list.
// Schema also exposes createInstance/destroyInstance/listInstances, but only
// instance(id?) continues the browse chain, so it is the only one offered.
const SCHEMA_METHODS = ["instance"];
const INSTANCE_METHODS = ["table"]; // a SchemaInstance only exposes table(name)
const QUERY_METHODS = [
	"slice",
	"orderBy",
	"filter",
	"map",
	"pluck",
	"get",
	"getAll",
	"between",
	"count",
	"limit",
	"insert",
	"update",
	"replace",
	"delete",
	"do",
	"default",
	"key",
	"lookup",
	"changes",
];

interface CompletionItem {
	label: string;
	type: string;
	detail?: string;
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
		  ) => void);
}

const opt = (label: string, type: string, detail?: string): CompletionItem => ({
	label,
	type,
	detail,
});

// Schema-derived names, indexed per schema so completions can be scoped to the
// schema in the current chain. Rebuilt whenever the live schema list changes; the
// completion source reads `.value` lazily, so no editor reconfigure is needed.
const completionData = computed(() => {
	const schemaIds: string[] = [];
	const tablesBySchema: Record<string, string[]> = {};
	const fieldsBySchema: Record<string, string[]> = {};
	const instancesBySchema: Record<string, string[]> = {};
	const allTables = new Set<string>();
	const allFields = new Set<string>();
	for (const schema of props.schemas ?? []) {
		schemaIds.push(schema.id);
		instancesBySchema[schema.id] = schema.instances ?? [];
		const tables: string[] = [];
		const fields = new Set<string>();
		for (const table of schema.tables ?? []) {
			tables.push(table.name);
			allTables.add(table.name);
			for (const field of Object.keys(table.fields ?? {})) {
				fields.add(field);
				allFields.add(field);
			}
		}
		tablesBySchema[schema.id] = tables;
		fieldsBySchema[schema.id] = [...fields];
	}
	return {
		schemaIds,
		tablesBySchema,
		fieldsBySchema,
		instancesBySchema,
		allTables: [...allTables],
		allFields: [...allFields],
	};
});

// `schemas.demo` (dot) or `schemas["dms-core"]` (bracket — required for ids that
// aren't valid JS identifiers). Used to scope table/field/instance completions.
function currentSchemaId(before: string): string | null {
	const re =
		/schemas\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["'`]([\w$-]+)["'`]\s*\])/g;
	let last: string | null = null;
	for (
		let match = re.exec(before);
		match !== null;
		match = re.exec(before)
	) {
		last = match[1] ?? match[2] ?? null;
	}
	return last;
}

function listFor(
	map: Record<string, string[]>,
	schemaId: string | null,
	fallback: string[],
): string[] {
	return (schemaId && map[schemaId]) || fallback;
}

function completionSource(ctx: CompletionContext): CompletionResult | null {
	const data = completionData.value;
	// A bounded look-behind window covers multi-line chains without scanning the
	// whole document on every keystroke.
	const before = ctx.state.sliceDoc(Math.max(0, ctx.pos - 240), ctx.pos);

	// `instance(<id>)` argument → that schema's instance ids (+ CROSS_INSTANCE).
	// Acts as parameter help: it surfaces what instance() accepts. Quote-aware.
	const inInstance =
		/(?:^|[^\w$.])schemas\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["'`]([\w$-]+)["'`]\s*\])\s*\.\s*instance\(\s*(["'`])?([\w$-]*)$/.exec(
			before,
		);
	if (inInstance) {
		const schemaId = inInstance[1] ?? inInstance[2] ?? "";
		const quote = inInstance[3];
		const typed = inInstance[4] ?? "";
		const options: CompletionItem[] = (
			data.instancesBySchema[schemaId] ?? []
		).map((id) => ({
			label: id,
			type: "enum",
			detail: "instance id",
			apply: quote ? id : `"${id}"`,
		}));
		// CROSS_INSTANCE is a bare identifier, so only when not inside a quote.
		if (!quote) {
			options.push({
				label: "CROSS_INSTANCE",
				type: "constant",
				detail: "all instances (read-only)",
			});
		}
		if (!options.length) return null;
		return { from: ctx.pos - typed.length, validFor: /[\w$-]*/, options };
	}
	// Schema id inside bracket access: `schemas["…`.
	const inSchemaBracket = /schemas\s*\[\s*["'`]([\w$-]*)$/.exec(before);
	if (inSchemaBracket) {
		const typed = inSchemaBracket[1] ?? "";
		return {
			from: ctx.pos - typed.length,
			validFor: /[\w$-]*/,
			options: data.schemaIds.map((id) => opt(id, "namespace", "schema")),
		};
	}
	// `table(<name>)` argument → that schema's table names. Quote-aware.
	const inTable = /\.table\(\s*(["'`])?([\w$-]*)$/.exec(before);
	if (inTable) {
		const quote = inTable[1];
		const typed = inTable[2] ?? "";
		const tables = listFor(
			data.tablesBySchema,
			currentSchemaId(before),
			data.allTables,
		);
		return {
			from: ctx.pos - typed.length,
			validFor: /[\w$-]*/,
			options: tables.map((name) => ({
				label: name,
				type: "class",
				detail: "table",
				apply: quote ? name : `"${name}"`,
			})),
		};
	}
	// Quoted field name inside a field selector (`pluck` / `orderBy` / `key`).
	const inField = /\.(?:pluck|orderBy|key)\([^)]*["'`]([\w$]*)$/.exec(before);
	if (inField) {
		const typed = inField[1] ?? "";
		const fields = listFor(
			data.fieldsBySchema,
			currentSchemaId(before),
			data.allFields,
		);
		return {
			from: ctx.pos - typed.length,
			validFor: /[\w$]*/,
			options: fields.map((name) => opt(name, "property", "field")),
		};
	}

	// Member access / bare identifier.
	const typed = before.match(/[\w$]*$/)?.[0] ?? "";
	const upto = before.slice(0, before.length - typed.length);
	const from = ctx.pos - typed.length;

	if (upto.endsWith(".")) {
		const chain = upto.slice(0, -1).trimEnd();
		if (/(?:^|[^\w$.])schemas$/.test(chain)) {
			// `schemas.` → schema ids. Ids that aren't valid identifiers rewrite the
			// dot to bracket form (`schemas["dms-core"]`).
			return {
				from,
				validFor: /[\w$]*/,
				options: data.schemaIds.map((id) => {
					if (/^[A-Z_$][\w$]*$/i.test(id)) {
						return opt(id, "namespace", "schema");
					}
					return {
						label: id,
						type: "namespace",
						detail: "schema",
						apply: (view, _completion, fromPos, toPos) =>
							view.dispatch({
								changes: {
									from: fromPos - 1,
									to: toPos,
									insert: `[${JSON.stringify(id)}]`,
								},
							}),
					};
				}),
			};
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
				options: SCHEMA_METHODS.map((m) => opt(m, "method", "Schema")),
			};
		}
		if (chain.endsWith(")")) {
			// A completed call → its result's methods.
			const options = /\binstance\s*\([^()]*\)$/.test(chain)
				? INSTANCE_METHODS.map((m) => opt(m, "method", "SchemaInstance"))
				: QUERY_METHODS.map((m) => opt(m, "method", "Query"));
			return { from, validFor: /[\w$]*/, options };
		}
		// A `.` after a bare, uncalled method (e.g. `…instance.`) is not a DSL step.
		return null;
	}

	// Top level: the entry point only.
	if (!typed && !ctx.explicit) return null;
	return { from, validFor: /[\w$]*/, options: [opt("schemas", "variable", "root")] };
}

// --- editor -----------------------------------------------------------------
const editorContainer = ref<HTMLElement | null>(null);
let view: EditorView | null = null;
const themeCompartment = new Compartment();
const colorMode = useColorMode();

// Transparent surfaces so the editor blends into the DmsCard (bg-default).
const baseTheme = EditorView.theme({
	"&": { backgroundColor: "transparent", height: "100%", fontSize: "13px" },
	"&.cm-focused": { outline: "none" },
	".cm-scroller": {
		fontFamily:
			"ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
		lineHeight: "1.6",
	},
	".cm-content": { padding: "12px 0" },
	".cm-gutters": { backgroundColor: "transparent", border: "none" },
	".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
});

function themeExtension() {
	return colorMode.value === "dark"
		? oneDark
		: syntaxHighlighting(defaultHighlightStyle, { fallback: true });
}

onMounted(() => {
	if (!editorContainer.value) return;
	const state = EditorState.create({
		doc: internalValue.value,
		extensions: [
			lineNumbers(),
			history(),
			bracketMatching(),
			indentOnInput(),
			javascript({ typescript: true }),
			autocompletion({ override: [completionSource], activateOnTyping: true }),
			cmPlaceholder(BUILDER_EXAMPLE),
			EditorView.lineWrapping,
			keymap.of([
				{
					key: "Mod-Enter",
					preventDefault: true,
					run: () => {
						if (canExecute()) emit("execute");
						return true;
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
				if (!update.docChanged) return;
				const text = update.state.doc.toString();
				if (text !== props.modelValue) emit("update:modelValue", text);
			}),
		],
	});
	view = new EditorView({ state, parent: editorContainer.value });
});

// External edits (history load, format, clear) → push into the editor.
watch(
	() => props.modelValue,
	(value) => {
		if (view && value !== view.state.doc.toString()) {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: value },
			});
		}
	},
);

// Swap the syntax theme when the app toggles light/dark.
watch(
	() => colorMode.value,
	() => {
		view?.dispatch({
			effects: themeCompartment.reconfigure(themeExtension()),
		});
	},
);

onBeforeUnmount(() => {
	view?.destroy();
	view = null;
});
</script>

<template>
	<DmsCard :padded="false" class="overflow-hidden">
		<!-- editor bar -->
		<div
			class="flex items-center gap-2 px-3.5 py-3 border-b border-default flex-wrap"
		>
			<USelect
				v-model="internalLanguage"
				:items="languageOptions"
				:aria-label="$t('dms_database.query.language')"
				size="sm"
				class="w-24"
			/>
			<span class="inline-flex items-center gap-1.5 text-[11.5px] text-dimmed">
				<UIcon name="i-ph-brackets-curly" class="size-3.5" />
				{{ $t("dms_database.query.hint") }}
			</span>
			<span class="flex-1" />
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-ph-magic-wand"
				:label="$t('dms_database.query.format')"
				:disabled="!internalValue.trim()"
				@click="runFormat"
			/>
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-ph-floppy-disk"
				:label="$t('dms_database.query.save')"
				:disabled="!internalValue.trim()"
				@click="emit('save')"
			/>
			<UButton
				size="sm"
				color="primary"
				icon="i-ph-lightning"
				:loading="executing"
				:disabled="!internalValue.trim() || executing"
				@click="emit('execute')"
			>
				{{ $t("dms_database.query.execute") }}
				<UKbd value="meta" size="sm" class="ml-1" />
				<UKbd value="enter" size="sm" />
			</UButton>
		</div>

		<!-- editor (CodeMirror mounts here on the client) -->
		<div
			ref="editorContainer"
			class="h-64 overflow-auto bg-default text-toned"
		/>

		<!-- builder hint footer -->
		<div
			class="flex items-center gap-2 px-3.5 py-3 border-t border-default flex-wrap"
		>
			<span
				class="font-mono text-[10px] uppercase tracking-wider text-dimmed shrink-0"
			>
				{{ $t("dms_database.query.builderHintLabel") }}
			</span>
			<code class="text-[11.5px] font-mono text-muted truncate">
				{{ BUILDER_EXAMPLE }}
			</code>
		</div>
	</DmsCard>
</template>

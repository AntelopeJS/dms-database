<script setup lang="ts">
import {
	CROSS_INSTANCE_VALUE,
	DEFAULT_INSTANCE_VALUE,
	instanceBadge,
} from '../build/composables/useDataBrowserTabs'
import { browseSelectionQuery } from '../build/composables/useDataBrowserGrid'
import { onKeyStroke } from '@vueuse/core'
import { useDrawerRoom } from '../build/composables/useDrawerRoom'
import {
	cellLabel,
	cellText,
	draftText,
	isStructured,
	isWideValue,
	parseDraft,
} from '../build/data/cellValues'
import type { RowNavigation } from '../build/data/rowDrawerHeader'
import { useStagedEdits } from '../build/data/stagedEdits'
import type { TableSummary } from '../build/composables/useDatabaseSchemas'
import type { BrowserTab } from '../build/composables/useDataBrowserTabs'
import type { GridColumn } from '../build/composables/useDataBrowserGrid'
import { tableLink } from '../build/utils/databaseLinks'
import { describeRuntimeType } from '../build/utils/fieldTypes'
import DrawerTabs from './DrawerTabs.vue'

// One row of the data browser in a drawer: its fields, editable and staged
// like the grid's cells, its JSON, and the rows of other tables pointing at
// it. The DMS row header names the row, its position and previous / next; J
// and K step to the next and previous row of the page.

interface RowReference {
	schema: string
	table: string
	field: string
	count: number
}

type DrawerTab = 'fields' | 'json' | 'references'

const props = defineProps<{
	tab: BrowserTab
	row: Record<string, unknown>
	rowId: string | null
	columns: GridColumn[]
	table?: TableSummary
	readOnly: boolean
	navigation?: RowNavigation
	onStage: (rowId: string, field: string, value: unknown) => void
	onReview: () => void
}>()

// A link out closes the drawer: the page it opens may be this one.
const emit = defineEmits<{ success: [] }>()

const { t, n } = useI18n()
const staged = useStagedEdits()

const active = ref<DrawerTab>('fields')
// The footer sits at the drawer's end however short the tab.
const room = useDrawerRoom(useTemplateRef('panel'))
const drafts = reactive<Record<string, string>>({})
const errors = reactive<Record<string, string>>({})

const relations = computed(
	() =>
		new Map(
			(props.table?.relations ?? []).map((relation) => [
				relation.fromField,
				relation,
			]),
		),
)

function valueOf(field: string): unknown {
	if (!props.rowId) return props.row[field]
	const cell = staged.get(props.tab.id, props.rowId, field)
	return cell ? cell.after : props.row[field]
}

const fields = computed(() =>
	props.columns.map((column) => {
		const relation = relations.value.get(column.name)
		const value = valueOf(column.name)
		return {
			name: column.name,
			column,
			value,
			key: column.isPrimaryKey,
			relation,
			structured: isStructured(value),
			// Laid out by the value read: editing it does not move the row.
			wide: isWideValue(props.row[column.name]),
			type: relation
				? relation.toTable
				: describeRuntimeType(column.type, column.name).label,
			icon: column.isPrimaryKey
				? 'i-ph-key'
				: relation
					? 'i-ph-arrow-right'
					: describeRuntimeType(column.type, column.name).icon,
			staged: props.rowId
				? staged.get(props.tab.id, props.rowId, column.name)
				: undefined,
			editable:
				!props.readOnly &&
				!column.isPrimaryKey &&
				column.name !== '_instance' &&
				props.rowId !== null,
		}
	}),
)

const pending = computed(() =>
	props.rowId ? staged.rowCount(props.tab.id, props.rowId) : 0,
)
// The review writes every staged change of the table, this row's and others'.
const tabPending = computed(() => staged.count(props.tab.id))
const stagedRow = computed(() =>
	Object.fromEntries(
		props.columns.map((column) => [column.name, valueOf(column.name)]),
	),
)
const json = computed(() => JSON.stringify(stagedRow.value, null, 2))

function draftOf(field: string, value: unknown): string {
	return (
		drafts[field] ??
		(isStructured(value) ? JSON.stringify(value, null, 2) : draftText(value))
	)
}

function commit(field: (typeof fields.value)[number]) {
	const draft = drafts[field.name]
	if (draft === undefined || !props.rowId) return
	Reflect.deleteProperty(errors, field.name)
	if (field.structured) {
		try {
			props.onStage(props.rowId, field.name, JSON.parse(draft))
		} catch {
			errors[field.name] = t('dms_database.data.row.invalid_json')
			return
		}
	} else {
		const result = parseDraft(draft, field.value, field.column.type)
		if (!result.ok) {
			errors[field.name] = t(`dms_database.data.grid.invalid_${result.reason}`)
			return
		}
		if (!result.unchanged) props.onStage(props.rowId, field.name, result.value)
	}
	Reflect.deleteProperty(drafts, field.name)
}

// The id the row's label names its control by.
function controlId(field: string): string {
	return `dms-database-row-field-${field.replace(/[^\w-]/g, '_')}`
}

function setNull(field: string) {
	if (!props.rowId) return
	Reflect.deleteProperty(drafts, field)
	props.onStage(props.rowId, field, null)
}

function setBoolean(field: string, value: boolean) {
	if (props.rowId) props.onStage(props.rowId, field, value)
}

// --- referenced by ---
// Read once the drawer opens, in the browser.
const referencesRead = useApiData<{ items: RowReference[] }>(
	() =>
		props.rowId && !props.readOnly ? '/api/database/browse/references' : null,
	{
		query: () => ({ ...browseSelectionQuery(props.tab), id: props.rowId }),
		immediate: false,
		server: false,
	},
)
const references = computed(() => referencesRead.data.value?.items ?? null)
const referencesFailed = computed(() => referencesRead.status.value === 'error')

function loadReferences() {
	void referencesRead.execute()
}

onMounted(loadReferences)

const referenceTotal = computed(() =>
	(references.value ?? []).reduce((sum, reference) => sum + reference.count, 0),
)

const tabs = computed(() => {
	const items: { value: DrawerTab; label: string; badge?: number }[] = [
		{
			value: 'fields',
			label: t('dms_database.data.row.fields'),
			badge: props.columns.length,
		},
		{ value: 'json', label: t('dms_database.data.row.json') },
	]
	if (!props.readOnly)
		items.push({
			value: 'references',
			label: t('dms_database.data.row.references'),
			badge: referenceTotal.value,
		})
	return items
})

const scope = computed(() => {
	const badge = instanceBadge(
		props.tab.instance,
		t('dms_database.data.scope.all'),
	)
	return `${props.tab.schema}.${props.tab.table}${badge ? ` ${badge}` : ''}`
})

// The instance a link to a table of the same schema keeps.
const scopedInstance = computed(() =>
	props.tab.instance === DEFAULT_INSTANCE_VALUE ||
	props.tab.instance === CROSS_INSTANCE_VALUE
		? undefined
		: props.tab.instance,
)

function typing(event: KeyboardEvent): boolean {
	return Boolean(
		(event.target as HTMLElement | null)?.closest('input, textarea, select'),
	)
}

onKeyStroke('j', (event) => {
	if (!typing(event) && props.navigation?.hasNext) props.navigation.next()
})
onKeyStroke('k', (event) => {
	if (!typing(event) && props.navigation?.hasPrev) props.navigation.prev()
})
</script>

<template>
	<!-- As wide as the side drawer, as the table inspector; as tall as its
		body, so the footer sits at its end. The drawer's body scrolls: the DMS
		row header stays in view, the footer sticks to the bottom. -->
	<div
		ref="panel"
		class="flex w-full min-w-0 flex-col gap-4"
		:style="room === null ? undefined : { minHeight: `${room}px` }"
	>
		<header class="grid gap-3">
			<p
				class="text-muted flex min-w-0 items-start gap-1.5 font-mono text-xs"
				data-row-scope
			>
				<UIcon name="i-ph-table" class="mt-px size-3.5 shrink-0" />
				<span class="min-w-0 [overflow-wrap:anywhere]">{{ scope }}</span>
			</p>
			<DrawerTabs v-model="active" :items="tabs" />
		</header>

		<div class="min-w-0">
			<!-- Each field is a DMS form row: the column's name in the label
				column, its type and staged change as help, the error under the
				control. A wide value (JSON, a long text) takes the row's width
				under its label; the others sit beside it once the row is wide
				enough (the row's container query). Every control keeps the same
				end slot, "Set to null" or nothing: the column stays even. -->
			<div v-if="active === 'fields'" class="flex flex-col">
				<DmsFieldRow
					v-for="field in fields"
					:key="field.name"
					:layout="field.wide ? 'stack' : 'form'"
					:data-field-row="field.name"
					:inset="false"
					spacing="row"
					:label-for="field.editable ? controlId(field.name) : undefined"
				>
					<template #label>
						<span class="font-mono">{{ field.name }}</span>
					</template>
					<template #details>
						<p
							class="mt-0.5 flex items-center gap-1 font-mono text-[12px] leading-normal"
							:class="
								field.key
									? 'text-warning'
									: field.relation
										? 'text-primary'
										: 'text-muted'
							"
						>
							<UIcon :name="field.icon" class="size-3 shrink-0" />
							{{
								field.key ? t('dms_database.inspector.primary_key') : field.type
							}}
						</p>
						<p
							v-if="field.staged"
							class="text-warning mt-0.5 break-all font-mono text-[12px] leading-normal"
						>
							{{
								t('dms_database.data.row.was', {
									value: cellLabel(field.staged.before),
								})
							}}
						</p>
					</template>

					<p
						v-if="!field.editable"
						class="text-muted break-all pt-1.5 font-mono text-[12.5px]"
					>
						{{ cellLabel(field.value) }}
						<span v-if="field.key" class="text-dimmed font-sans">
							· {{ t('dms_database.data.row.not_editable') }}
						</span>
					</p>
					<UFormField
						v-else
						:name="field.name"
						:error="errors[field.name] ?? false"
						:data-field="field.name"
						class="min-w-0"
					>
						<div
							class="flex min-w-0 gap-2"
							:class="field.wide ? 'items-start' : 'min-h-8 items-center'"
						>
							<div class="min-w-0 flex-1">
								<DmsSwitch
									v-if="typeof field.value === 'boolean'"
									:id="controlId(field.name)"
									:model-value="field.value"
									@update:model-value="setBoolean(field.name, Boolean($event))"
								/>
								<!-- JSON, or a text of several lines: a text area. -->
								<DmsTextarea
									v-else-if="field.wide"
									:id="controlId(field.name)"
									:model-value="draftOf(field.name, field.value)"
									:rows="field.structured ? 4 : 2"
									autoresize
									class="w-full font-mono"
									:class="{ 'text-xs': field.structured }"
									:color="
										errors[field.name]
											? 'error'
											: field.staged
												? 'warning'
												: 'primary'
									"
									:highlight="Boolean(field.staged || errors[field.name])"
									@update:model-value="drafts[field.name] = String($event)"
									@blur="commit(field)"
								/>
								<DmsInputText
									v-else
									:id="controlId(field.name)"
									:model-value="draftOf(field.name, field.value)"
									:title="t('dms_database.data.grid.null_hint')"
									:placeholder="
										field.value === null || field.value === undefined
											? 'null'
											: undefined
									"
									class="w-full font-mono"
									:color="
										errors[field.name]
											? 'error'
											: field.staged
												? 'warning'
												: 'primary'
									"
									:highlight="Boolean(field.staged || errors[field.name])"
									@update:model-value="drafts[field.name] = String($event)"
									@blur="commit(field)"
									@keydown.enter.prevent="commit(field)"
								/>
							</div>
							<!-- The end slot, as wide with its button or without. -->
							<div class="flex w-8 shrink-0 justify-center" data-null-slot>
								<UButton
									v-if="field.value !== null && field.value !== undefined"
									icon="i-ph-circle-dashed"
									size="sm"
									color="neutral"
									variant="ghost"
									square
									:title="t('dms_database.data.row.set_null')"
									:aria-label="t('dms_database.data.row.set_null')"
									@click="setNull(field.name)"
								/>
							</div>
						</div>
						<template v-if="errors[field.name]" #error="{ error }">
							<DmsFormErrorText :error />
						</template>
					</UFormField>
					<DmsAutoLink
						@click="emit('success')"
						v-if="
							field.relation &&
							field.value !== null &&
							field.value !== undefined
						"
						:to="
							tableLink('data', {
								schema: field.relation.toSchema,
								table: field.relation.toTable,
								instance:
									field.relation.toSchema === tab.schema
										? scopedInstance
										: undefined,
								match: {
									field: field.relation.toField,
									value: cellText(field.value),
								},
							})
						"
						class="text-primary inline-flex items-center gap-1 justify-self-start text-xs hover:underline"
					>
						<UIcon name="i-ph-arrow-square-out" class="size-3" />
						{{
							t('dms_database.data.row.open_relation', {
								table: field.relation.toTable,
							})
						}}
					</DmsAutoLink>
				</DmsFieldRow>
			</div>

			<DmsCodeSnippet
				v-else-if="active === 'json'"
				:code="json"
				language="json"
			/>

			<div v-else class="grid gap-2">
				<DmsEmptyState
					v-if="referencesFailed"
					size="sm"
					variant="error"
					:title="t('dms_database.data.row.references_failed')"
					:actions="[
						{ label: t('dms_database.common.retry'), onClick: loadReferences },
					]"
				/>
				<DmsEmptyState
					v-else-if="references && references.length === 0"
					size="sm"
					:title="t('dms_database.data.row.references_none')"
				/>
				<DmsAutoLink
					@click="emit('success')"
					v-for="reference in references ?? []"
					:key="`${reference.schema}.${reference.table}.${reference.field}`"
					:to="
						tableLink('data', {
							schema: reference.schema,
							table: reference.table,
							instance:
								reference.schema === tab.schema ? scopedInstance : undefined,
							match: rowId
								? { field: reference.field, value: rowId }
								: undefined,
						})
					"
					class="border-default hover:bg-elevated/50 flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-[12.5px]"
				>
					<UIcon name="i-ph-table" class="text-primary size-3.5" />
					<span class="text-toned">
						{{
							reference.schema === tab.schema
								? reference.table
								: `${reference.schema}.${reference.table}`
						}}
					</span>
					<span class="text-dimmed ml-auto text-xs">
						{{
							t(
								'dms_database.data.row.reference_count',
								{ count: n(reference.count), field: reference.field },
								reference.count,
							)
						}}
					</span>
				</DmsAutoLink>
			</div>
		</div>

		<!-- The DMS drawer form's footer band, as the JSON editor's: at the
			drawer's end, flush with its edge, kept in sight while the body
			scrolls. -->
		<footer
			v-if="!readOnly"
			data-row-footer
			class="border-default bg-default sticky bottom-[calc(var(--dms-form-foot-pb,0px)*-1)] z-10 -mx-[var(--dms-form-foot-px,0px)] -mb-[var(--dms-form-foot-pb,0px)] mt-auto flex min-h-14 flex-wrap items-center gap-2 border-t px-[var(--dms-form-foot-px,0px)] pb-[var(--dms-form-foot-pb,12px)] pt-3"
		>
			<span class="text-dimmed flex items-center gap-1.5 text-xs">
				<span v-if="pending" class="bg-warning size-1.5 rounded-full" />
				{{
					pending
						? t('dms_database.data.tabs.unsaved', pending)
						: t('dms_database.data.row.no_change')
				}}
			</span>
			<UButton
				v-if="tabPending > 0"
				class="ml-auto"
				size="sm"
				icon="i-ph-check"
				:label="t('dms_database.data.save.review', tabPending)"
				@click="onReview"
			/>
		</footer>
	</div>
</template>

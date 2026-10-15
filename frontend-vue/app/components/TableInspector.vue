<script lang="ts">
import type { SchemaSummary } from '../build/composables/useDatabaseSchemas'

type InspectorTab = 'columns' | 'indexes' | 'relations' | 'sample'

// The drawer mounts the inspector anew on each table J / K step to: the
// last schemas and tab carry over, so the next table shows at once, on the
// same tab, while the schemas load again. Written in the browser only.
let lastSchemas: SchemaSummary[] | undefined
let lastTab: InspectorTab = 'columns'
</script>

<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import {
	findTableIn,
	inboundRelationsIn,
	useDatabaseSchemas,
	type FieldDescriptor,
} from '../build/composables/useDatabaseSchemas'
import {
	COLUMN_ROLE_CLASSES,
	type ColumnRole,
	describeField,
	describeModifier,
	isPrimaryKey,
} from '../build/utils/fieldTypes'
import { CROSS_INSTANCE_VALUE } from '../build/composables/useDataBrowserTabs'
import { ALL_INSTANCES_PARAM, tableLink } from '../build/utils/databaseLinks'

// The Schemas page's row drawer (D-07), also opened from the diagram: the
// facts of one table, its columns, indexes and relations both ways, and a
// sample row. The table view hands it the row and the means to step to the
// next one (J / K), or to show another row in place; a relation opens the
// table it names in its place.

interface TableRow {
	schema: string
	name: string
}

interface RowNavigation {
	index: number
	total: number
	hasPrev: boolean
	hasNext: boolean
	prev: () => void
	next: () => void
}

const props = defineProps<{
	rowData?: TableRow
	navigation?: RowNavigation
	showRow?: (row: object | string) => Promise<void>
}>()

// A link out closes the drawer.
const emit = defineEmits<{ success: [] }>()

// Descriptor kinds that admit an empty value on their own.
const NULLISH_KINDS = new Set<FieldDescriptor['kind']>([
	'null',
	'undefined',
	'any',
	'unknown',
])
const BROWSE_LIST = '/api/database/browse/list'
const BROWSE_COUNT = '/api/database/browse/count'

const { t, n } = useI18n()
const { copy } = useClipboard()
const toast = useToast()

const isBrowser = typeof window !== 'undefined'

const tab = ref<InspectorTab>(lastTab)
watch(tab, (value) => {
	if (isBrowser) lastTab = value
})

const {
	schemas: loadedSchemas,
	isSettled: schemasSettled,
	error: schemasError,
	refresh: refreshSchemas,
} = useDatabaseSchemas()
watch(schemasSettled, (settled) => {
	if (settled && !schemasError.value && isBrowser)
		lastSchemas = loadedSchemas.value
})
// Every schema: the last ones until these load, and should these fail.
const schemas = computed(() =>
	schemasSettled.value && !schemasError.value
		? loadedSchemas.value
		: lastSchemas,
)
const loading = computed(
	() => !schemasSettled.value && schemas.value === undefined,
)
const failed = computed(
	() => schemasSettled.value && schemas.value === undefined,
)

// The table a relation was followed to, in place of the row's, where the
// container cannot show another row (the diagram's drawer).
const followed = ref<TableRow | null>(null)
const shown = computed(() => followed.value ?? props.rowData)
// J / K step from the row the table view opened: its position is not the
// followed table's.
const rowNavigation = computed(() =>
	followed.value ? undefined : props.navigation,
)

const schemaId = computed(() => shown.value?.schema ?? '')
const tableName = computed(() => shown.value?.name ?? '')
const tableKey = computed(() => `${schemaId.value}::${tableName.value}`)
const table = computed(() =>
	findTableIn(schemas.value ?? [], schemaId.value, tableName.value),
)
// Renamed, dropped or mistyped: once the schemas are in, nothing names it.
const missing = computed(
	() => !loading.value && !failed.value && table.value === undefined,
)
const schema = computed(() =>
	schemas.value?.find((s) => s.id === schemaId.value),
)
const instanceCount = computed(() => schema.value?.stats.instanceCount ?? 1)
const address = computed(() => ({
	schema: schemaId.value,
	table: tableName.value,
}))

function isNullable(descriptor: FieldDescriptor): boolean {
	if (NULLISH_KINDS.has(descriptor.kind)) return true
	return (
		descriptor.kind === 'union' &&
		descriptor.members.some((m) => m.kind === 'null' || m.kind === 'undefined')
	)
}

const relationByField = computed(
	() => new Map((table.value?.relations ?? []).map((r) => [r.fromField, r])),
)

const columns = computed(() => {
	const current = table.value
	if (!current) return []
	return Object.entries(current.fields).map(([name, descriptor]) => {
		const relation = relationByField.value.get(name)
		const key = isPrimaryKey(name, current.indexes ?? {})
		const role: ColumnRole = key ? 'key' : relation ? 'relation' : 'plain'
		const type = describeField(descriptor, name)
		return {
			name,
			role,
			icon: key ? 'i-ph-key' : relation ? 'i-ph-arrow-right' : type.icon,
			label: key
				? t('dms_database.inspector.primary_key')
				: relation
					? relation.toTable
					: type.label,
			nullable: !key && isNullable(descriptor),
			modifiers: (current.modifiers?.[name] ?? []).map(describeModifier),
		}
	})
})

const indexes = computed(() =>
	Object.entries(table.value?.indexes ?? {}).map(([name, index]) => ({
		name,
		fields: index.fields ?? [],
		compound: (index.fields?.length ?? 0) > 1,
		multi: Boolean(index.multi),
	})),
)

// A table outside the inspected one's schema is named with its schema.
function qualified(schemaOf: string, name: string): string {
	return schemaOf === schemaId.value ? name : `${schemaOf}.${name}`
}

const outgoing = computed(() =>
	(table.value?.relations ?? []).map((r) => ({
		key: `out-${r.fromField}`,
		from: `${tableName.value}.${r.fromField}`,
		to: `${qualified(r.toSchema, r.toTable)}.${r.toField}`,
		cardinality: r.many ? 'N : N' : 'N : 1',
		target: { schema: r.toSchema, name: r.toTable },
	})),
)

const incoming = computed(() =>
	inboundRelationsIn(schemas.value ?? [], schemaId.value, tableName.value).map(
		(r) => ({
			key: `in-${r.fromSchema}-${r.fromTable}-${r.fromField}`,
			from: `${qualified(r.fromSchema, r.fromTable)}.${r.fromField}`,
			to: `${tableName.value}.${r.toField}`,
			cardinality: r.many ? 'N : N' : 'N : 1',
			target: { schema: r.fromSchema, name: r.fromTable },
		}),
	),
)

// The table view shows the relation's table as its own row: the URL, the
// position and J / K follow it. Elsewhere, or should it fail to read the
// row, the inspector shows it itself, and the row's own table again closes
// the detour.
async function follow(target: TableRow) {
	if (props.showRow) {
		try {
			await props.showRow(`${target.schema}::${target.name}`)
			return
		} catch {
			// Shown in place below.
		}
	}
	const own =
		target.schema === props.rowData?.schema &&
		target.name === props.rowData?.name
	followed.value = own ? null : target
}

// --- rows: in every instance at once; the data browser shows each one's ---
// Read with the table, on the server too when the link opens the drawer; no
// figure shows while another table's loads, nor once it failed.
const rowTotal = useApiData<{ total: number }>(
	() => (schemaId.value && tableName.value ? BROWSE_COUNT : null),
	{
		query: () => ({
			filter_schema: `is:${schemaId.value}`,
			filter_table: `is:${tableName.value}`,
			filter_instance: `is:${CROSS_INSTANCE_VALUE}`,
		}),
	},
)
const total = computed(() =>
	rowTotal.status.value === 'success'
		? (rowTotal.data.value?.total ?? null)
		: null,
)

const rowsFact = computed(() => {
	const rows = total.value
	return rows === null
		? ''
		: t('dms_database.inspector.facts.rows', { count: n(rows) }, rows)
})

const structureFacts = computed(() =>
	[
		t('dms_database.inspector.facts.columns', columns.value.length),
		t('dms_database.inspector.facts.indexes', indexes.value.length),
		t(
			'dms_database.inspector.facts.relations',
			outgoing.value.length + incoming.value.length,
		),
	].join(' · '),
)

const tabs = computed(() => [
	{
		value: 'columns',
		label: t('dms_database.inspector.tabs.columns'),
		badge: loading.value ? undefined : columns.value.length,
	},
	{
		value: 'indexes',
		label: t('dms_database.inspector.tabs.indexes'),
		badge: loading.value ? undefined : indexes.value.length,
	},
	{
		value: 'relations',
		label: t('dms_database.inspector.tabs.relations'),
		badge: loading.value
			? undefined
			: outgoing.value.length + incoming.value.length,
	},
	{ value: 'sample', label: t('dms_database.inspector.tabs.sample') },
])

// --- sample row: the latest row, or the next one on demand ---
interface SamplePage {
	results: Record<string, unknown>[]
	total: number
}

/**
 * The row asked for: its offset in an instance. No instance at offset 0 reads
 * the default one, or the first named instance holding rows when the default
 * one holds none.
 */
interface SampleRequest {
	instance: string | null
	offset: number
}

/** A sample read, with the table and the instance it was read from. */
interface SampleRead {
	table: string
	instance: string | null
	page: SamplePage
}

const requested = shallowRef<SampleRequest>({ instance: null, offset: 0 })

type ReadSample = (instance: string | null) => Promise<SamplePage>

async function firstFilledInstance(
	read: ReadSample,
): Promise<{ instance: string | null; page: SamplePage }> {
	const page = await read(null)
	if (page.total > 0) return { instance: null, page }
	for (const instance of schema.value?.instances ?? []) {
		const named = await read(instance)
		if (named.total > 0) return { instance, page: named }
	}
	return { instance: null, page }
}

// Read once the Sample tab shows, in the browser only.
const sampleRead = useApiData<SampleRead>(
	() =>
		schemaId.value && tableName.value
			? `dms-database:sample:${JSON.stringify([
					tableKey.value,
					requested.value.instance,
					requested.value.offset,
				])}`
			: null,
	async ({ $authFetch, signal }) => {
		const table = tableKey.value
		const { instance, offset } = requested.value
		const read: ReadSample = (from) =>
			$authFetch<SamplePage>(BROWSE_LIST, {
				query: {
					filter_schema: `is:${schemaId.value}`,
					filter_table: `is:${tableName.value}`,
					offset,
					limit: 1,
					...(from ? { filter_instance: `is:${from}` } : {}),
				},
				signal,
			})
		const found =
			instance === null && offset === 0
				? await firstFilledInstance(read)
				: { instance, page: await read(instance) }
		return { table, ...found }
	},
	{
		immediate: false,
		server: false,
		watch: false,
		refreshOnPageRefresh: false,
	},
)

// Another table (a relation followed) shows none of the previous one's row.
const sampleShown = computed(() => {
	const value = sampleRead.data.value
	return value?.table === tableKey.value ? value : null
})
const sample = computed(() => sampleShown.value?.page.results?.[0] ?? null)
const sampleTotal = computed(() => sampleShown.value?.page.total ?? 0)
const sampleOffset = computed(() => requested.value.offset)
const sampleLoading = computed(() => sampleRead.pending.value)
const sampleFailed = computed(() => sampleRead.status.value === 'error')
// The instance the sample is read from.
const sampleInstance = computed(() => sampleShown.value?.instance ?? null)

const sampleInstanceLabel = computed(() =>
	sampleInstance.value === null
		? t('dms_database.inspector.sample.default_instance')
		: t('dms_database.inspector.sample.named_instance', {
				name: sampleInstance.value,
			}),
)

function loadSample() {
	if (schemaId.value && tableName.value) void sampleRead.execute()
}

function nextSample() {
	const total = sampleTotal.value
	requested.value = {
		instance: sampleInstance.value,
		offset: total > 0 ? (requested.value.offset + 1) % total : 0,
	}
	loadSample()
}

// Another table (a relation followed) starts over from its latest row.
watch(tableKey, () => {
	requested.value = { instance: null, offset: 0 }
	if (tab.value === 'sample' && !loading.value) loadSample()
})

// The sample waits for the schemas: they name the instances to look in.
onMounted(() =>
	watch(
		() => tab.value === 'sample' && !loading.value,
		(ready) => {
			if (ready && !sample.value && !sampleLoading.value) loadSample()
		},
		{ immediate: true },
	),
)

// The `_instance` tag the store adds to rows of named instances is not a
// column of the table.
const sampleJson = computed(() => {
	if (!sample.value) return ''
	const { _instance: _tag, ...row } = sample.value
	return JSON.stringify(row, null, 2)
})

async function copyName() {
	await copy(tableName.value)
	toast.add({
		title: t('dms_database.inspector.copied', { name: tableName.value }),
		color: 'success',
		icon: 'i-ph-check',
	})
}
</script>

<template>
	<!-- As wide as the side drawer, whatever the open tab holds. -->
	<div class="flex h-full w-full min-w-0 flex-col gap-4">
		<header class="grid grid-cols-[minmax(0,1fr)] gap-3">
			<div class="flex min-w-0 items-center gap-2">
				<DmsEyebrow
					class="min-w-0 truncate"
					:label="t('dms_database.inspector.eyebrow', { schema: schemaId })"
				/>
				<span class="flex-1" />
				<template v-if="rowNavigation">
					<span class="text-dimmed shrink-0 font-mono text-[11px] tabular-nums">
						{{ rowNavigation.index + 1 }} / {{ rowNavigation.total }}
					</span>
					<UButton
						icon="i-ph-caret-up"
						color="neutral"
						variant="ghost"
						size="xs"
						:disabled="!rowNavigation.hasPrev"
						:aria-label="t('dms_database.inspector.previous')"
						:title="t('dms_database.inspector.previous')"
						@click="rowNavigation.prev()"
					/>
					<UButton
						icon="i-ph-caret-down"
						color="neutral"
						variant="ghost"
						size="xs"
						:disabled="!rowNavigation.hasNext"
						:aria-label="t('dms_database.inspector.next')"
						:title="t('dms_database.inspector.next')"
						@click="rowNavigation.next()"
					/>
				</template>
			</div>
			<div class="flex min-w-0 flex-wrap items-center gap-2">
				<h3
					class="text-highlighted min-w-0 break-all font-mono text-lg font-semibold"
				>
					{{ tableName }}
				</h3>
				<UBadge
					v-if="!loading"
					color="neutral"
					variant="outline"
					size="sm"
					class="font-mono"
				>
					{{ t('dms_database.inspector.instances', instanceCount) }}
				</UBadge>
				<UButton
					icon="i-ph-copy"
					color="neutral"
					variant="ghost"
					size="xs"
					:aria-label="t('dms_database.inspector.copy_name')"
					:title="t('dms_database.inspector.copy_name')"
					@click="copyName"
				/>
			</div>
			<div v-if="loading" class="grid gap-2" aria-busy="true">
				<USkeleton class="h-4 w-40" />
				<USkeleton class="h-4 w-64 max-w-full" />
			</div>
			<div v-else class="text-muted grid gap-0.5 text-sm tabular-nums">
				<p v-if="rowsFact">
					{{ rowsFact }}
					<template v-if="instanceCount > 1">
						·
						<DmsAutoLink
							@click="emit('success')"
							:to="
								tableLink('data', { ...address, instance: ALL_INSTANCES_PARAM })
							"
							class="text-primary hover:underline"
						>
							{{ t('dms_database.inspector.facts.by_instance') }}
						</DmsAutoLink>
					</template>
				</p>
				<p>{{ structureFacts }}</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<UButton
					:to="tableLink('data', address)"
					@click="emit('success')"
					icon="i-ph-rows"
					size="sm"
					:label="t('dms_database.inspector.actions.browse')"
				/>
				<UButton
					:to="tableLink('query', address)"
					@click="emit('success')"
					icon="i-ph-code"
					size="sm"
					color="neutral"
					variant="outline"
					:label="t('dms_database.inspector.actions.query')"
				/>
				<UButton
					:to="tableLink('diagram', address)"
					@click="emit('success')"
					icon="i-ph-graph"
					size="sm"
					color="neutral"
					variant="ghost"
					:label="t('dms_database.inspector.actions.diagram')"
				/>
			</div>
			<!-- The tab list scrolls sideways on its own: held to the header's
				width, the four tabs scroll on a phone rather than overflow. -->
			<UTabs
				v-model="tab"
				:items="tabs"
				variant="link"
				size="sm"
				:content="false"
				class="min-w-0"
			/>
		</header>

		<div class="min-h-0 min-w-0 flex-1 overflow-auto">
			<div v-if="loading" class="grid gap-3" aria-busy="true">
				<USkeleton v-for="line in 6" :key="line" class="h-7 w-full" />
			</div>

			<DmsEmptyState
				v-else-if="failed"
				size="sm"
				variant="error"
				:title="t('dms_database.inspector.load_error')"
				:actions="[
					{
						label: t('dms_database.common.retry'),
						icon: 'i-ph-arrows-clockwise',
						onClick: refreshSchemas,
					},
				]"
			/>

			<DmsEmptyState
				v-else-if="missing"
				size="sm"
				variant="no-result"
				icon="i-ph-magnifying-glass"
				:title="t('dms_database.schemas.inspector.not_found')"
				:description="`${schemaId}.${tableName}`"
			/>

			<table v-else-if="tab === 'columns'" class="w-full text-sm">
				<thead>
					<tr class="border-default border-b text-left">
						<th class="text-dimmed py-2 pr-3 text-xs font-semibold">
							{{ t('dms_database.inspector.cols.column') }}
						</th>
						<th class="text-dimmed px-3 py-2 text-xs font-semibold">
							{{ t('dms_database.inspector.cols.type') }}
						</th>
						<th class="text-dimmed px-3 py-2 text-xs font-semibold">
							{{ t('dms_database.inspector.cols.null') }}
						</th>
						<th class="text-dimmed py-2 pl-3 text-xs font-semibold">
							{{ t('dms_database.inspector.cols.notes') }}
						</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="column in columns"
						:key="column.name"
						class="border-default/60 border-b last:border-0"
					>
						<td
							class="text-highlighted break-all py-2 pr-3 font-mono text-[12.5px]"
						>
							{{ column.name }}
						</td>
						<td class="px-3 py-2">
							<span
								class="inline-flex items-center gap-1.5 font-mono text-[11.5px]"
								:class="COLUMN_ROLE_CLASSES[column.role]"
							>
								<UIcon :name="column.icon" class="size-3.5 shrink-0" />
								{{ column.label }}
							</span>
						</td>
						<td class="px-3 py-2">
							<span
								v-if="column.nullable"
								class="text-dimmed rounded border border-dashed border-current px-1 font-mono text-[10.5px]"
							>
								null
							</span>
							<span v-else class="text-dimmed">—</span>
						</td>
						<td class="text-muted py-2 pl-3 text-xs">
							<span
								v-for="modifier in column.modifiers"
								:key="modifier.id"
								class="mr-2 inline-flex items-center gap-1"
							>
								<UIcon :name="modifier.icon" class="size-3.5" />
								{{ modifier.labelKey ? t(modifier.labelKey) : modifier.id }}
							</span>
						</td>
					</tr>
				</tbody>
			</table>

			<div v-else-if="tab === 'indexes'" class="grid gap-2">
				<div
					v-for="index in indexes"
					:key="index.name"
					class="border-default flex min-w-0 items-center gap-3 rounded-md border px-3 py-2.5"
				>
					<UBadge
						:color="index.compound ? 'primary' : 'neutral'"
						variant="subtle"
						size="sm"
						class="font-mono"
					>
						{{
							index.compound
								? t('dms_database.inspector.index.compound')
								: t('dms_database.inspector.index.single')
						}}
					</UBadge>
					<span class="text-toned min-w-0 truncate font-mono text-[12.5px]">
						{{ index.name }}
					</span>
					<span class="ml-auto flex flex-wrap justify-end gap-1">
						<span
							v-for="field in index.fields"
							:key="field"
							class="bg-elevated text-muted rounded px-1.5 py-0.5 font-mono text-[11px]"
						>
							{{ field }}
						</span>
					</span>
				</div>
				<DmsEmptyState
					v-if="indexes.length === 0"
					size="sm"
					icon="i-ph-key"
					:title="t('dms_database.inspector.index.empty')"
				/>
			</div>

			<div v-else-if="tab === 'relations'" class="grid gap-5">
				<section class="grid gap-2">
					<DmsEyebrow
						:label="
							t('dms_database.inspector.relations.out', {
								count: outgoing.length,
							})
						"
					/>
					<button
						v-for="relation in outgoing"
						:key="relation.key"
						type="button"
						class="border-default hover:bg-elevated/50 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-3 py-2 text-left font-mono text-[12px]"
						@click="follow(relation.target)"
					>
						<span class="text-toned truncate">{{ relation.from }}</span>
						<UIcon name="i-ph-arrow-right" class="text-info size-3.5" />
						<span class="text-info truncate">{{ relation.to }}</span>
						<span class="text-dimmed text-[10.5px]">
							{{ relation.cardinality }}
						</span>
					</button>
					<p v-if="outgoing.length === 0" class="text-dimmed text-sm">
						{{ t('dms_database.inspector.relations.none_out') }}
					</p>
				</section>
				<section class="grid gap-2">
					<DmsEyebrow
						:label="
							t('dms_database.inspector.relations.in', {
								count: incoming.length,
							})
						"
					/>
					<button
						v-for="relation in incoming"
						:key="relation.key"
						type="button"
						class="border-default hover:bg-elevated/50 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-3 py-2 text-left font-mono text-[12px]"
						@click="follow(relation.target)"
					>
						<span class="text-info truncate">{{ relation.from }}</span>
						<UIcon name="i-ph-arrow-right" class="text-info size-3.5" />
						<span class="text-toned truncate">{{ relation.to }}</span>
						<span class="text-dimmed text-[10.5px]">
							{{ relation.cardinality }}
						</span>
					</button>
					<p v-if="incoming.length === 0" class="text-dimmed text-sm">
						{{ t('dms_database.inspector.relations.none_in') }}
					</p>
				</section>
			</div>

			<div v-else class="grid gap-3">
				<!-- Nothing to page through in an empty table. -->
				<div
					v-if="sampleTotal > 0"
					class="flex min-w-0 items-center justify-between gap-2"
				>
					<DmsEyebrow
						class="min-w-0 truncate"
						:label="
							t('dms_database.inspector.sample.position', {
								position: sampleOffset + 1,
								total: sampleTotal,
								instance: sampleInstanceLabel,
							})
						"
					/>
					<UButton
						icon="i-ph-arrows-clockwise"
						color="neutral"
						variant="ghost"
						size="xs"
						:disabled="sampleTotal < 2"
						:loading="sampleLoading"
						:label="t('dms_database.inspector.sample.another')"
						@click="nextSample"
					/>
				</div>
				<DmsEmptyState
					v-if="sampleFailed"
					size="sm"
					variant="error"
					:title="t('dms_database.inspector.sample.error')"
					:actions="[
						{
							label: t('dms_database.common.retry'),
							icon: 'i-ph-arrows-clockwise',
							onClick: loadSample,
						},
					]"
				/>
				<div
					v-else-if="sampleLoading && !sample"
					class="grid gap-2"
					aria-busy="true"
				>
					<USkeleton v-for="line in 5" :key="line" class="h-4 w-full" />
				</div>
				<DmsEmptyState
					v-else-if="!sample"
					size="sm"
					:title="t('dms_database.inspector.sample.empty')"
				/>
				<DmsCodeSnippet v-else :code="sampleJson" language="json" />
			</div>
		</div>
	</div>
</template>

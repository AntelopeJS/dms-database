<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { downloadText, resultColumns, toCsv } from '../build/query/csv'
import { closestTable, unknownTable } from '../build/query/runs'
import { describeTarget, type QueryTarget } from '../build/query/target'
import type { SchemaSummary } from '../build/composables/useDatabaseSchemas'
import type { ExecuteResult } from '../build/composables/useQueryStore'
import {
	DATABASE_PAGES,
	tableAccess,
	tableLink,
} from '../build/utils/databaseLinks'

// The result of the last run (D-13): what it read or changed and where, the
// rows as a table, JSON or a chart with picked axes, copied or exported, and
// whether every row is shown. A failed run says what failed and, for a
// mistyped table, offers the right one.

type ResultMode = 'table' | 'json' | 'chart'

export interface QueryFailure {
	message: string
	durationMs: number
}

const props = defineProps<{
	result: ExecuteResult | null
	failure: QueryFailure | null
	target: QueryTarget
	schemas: SchemaSummary[]
}>()

const emit = defineEmits<{
	'use-source': [source: string]
	'replace-table': [from: string, to: string]
}>()

const MAX_TABLE_ROWS = 200
const EXAMPLE_ROWS = 10
const CHART_ROWS = 50

const { t, n } = useI18n()
const { copy } = useClipboard()
const toast = useToast()

const mode = ref<ResultMode>('table')
const modeItems = computed(() => [
	{
		label: t('dms_database.query.result.table'),
		value: 'table',
		icon: 'i-ph-table',
	},
	{
		label: t('dms_database.query.result.json'),
		value: 'json',
		icon: 'i-ph-brackets-curly',
	},
	{
		label: t('dms_database.query.result.chart'),
		value: 'chart',
		icon: 'i-ph-chart-bar',
	},
])

const rows = computed(() => props.result?.rows ?? [])
const columns = computed(() => resultColumns(rows.value))
const shownRows = computed(() => rows.value.slice(0, MAX_TABLE_ROWS))
const targetLabel = computed(() => describeTarget(props.target))

function renderCell(value: unknown): string {
	if (value === null || value === undefined) return 'null'
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

// --- links to the data browser ---
const browsable = computed(
	() =>
		Boolean(props.target.schema && props.target.table) &&
		props.target.instance !== '*',
)

function rowLink(row: Record<string, unknown>): string | null {
	const id = row._id
	if (!browsable.value || (typeof id !== 'string' && typeof id !== 'number'))
		return null
	return tableLink('data', {
		schema: props.target.schema ?? '',
		table: props.target.table ?? '',
		instance: props.target.instance || undefined,
		match: { field: '_id', value: String(id) },
	})
}

const tableBrowserLink = computed(() =>
	browsable.value
		? tableLink('data', {
				schema: props.target.schema ?? '',
				table: props.target.table ?? '',
				instance: props.target.instance || undefined,
			})
		: null,
)

// --- copy and export ---
async function copyJson() {
	await copy(JSON.stringify(rows.value, null, 2))
	toast.add({
		title: t('dms_database.query.result.copied', rows.value.length),
		color: 'success',
		icon: 'i-ph-check',
	})
}

function exportCsv() {
	const name = props.target.table ?? 'query'
	downloadText(`${name}.csv`, toCsv(rows.value), 'text/csv;charset=utf-8')
}

// --- chart with picked axes ---
const numericColumns = computed(() =>
	columns.value.filter((column) =>
		rows.value.some((row) => typeof row[column] === 'number'),
	),
)
const xColumn = ref<string | undefined>()
const yColumn = ref<string | undefined>()

watch(
	columns,
	() => {
		yColumn.value = numericColumns.value.includes(yColumn.value ?? '')
			? yColumn.value
			: numericColumns.value[0]
		xColumn.value = columns.value.includes(xColumn.value ?? '')
			? xColumn.value
			: columns.value.find((column) => column !== yColumn.value)
	},
	{ immediate: true },
)

const chartRows = computed(() => rows.value.slice(0, CHART_ROWS))
const chartDataset = computed(() => {
	const y = yColumn.value
	if (!y) return []
	return [
		{
			name: y,
			data: chartRows.value.map((row, index) => ({
				x: xColumn.value ? renderCell(row[xColumn.value]) : String(index + 1),
				y: typeof row[y] === 'number' ? (row[y] as number) : 0,
			})),
		},
	]
})

// --- first run and failures ---
const examples = computed(() => {
	const schema = props.schemas.find((candidate) => candidate.tables.length > 0)
	if (!schema) return []
	const [first, second] = schema.tables
	const items = [
		{
			label: t('dms_database.query.result.example_latest', {
				table: `${schema.id}.${first?.name}`,
			}),
			source: `${tableAccess({ schema: schema.id, table: first?.name ?? '' })}.slice(0, ${EXAMPLE_ROWS})`,
		},
	]
	const counted = second ?? first
	if (counted) {
		items.push({
			label: t('dms_database.query.result.example_count', {
				table: `${schema.id}.${counted.name}`,
			}),
			source: `${tableAccess({ schema: schema.id, table: counted.name })}.count()`,
		})
	}
	return items
})

const exampleActions = computed(() =>
	examples.value.map((example) => ({
		label: example.label,
		color: 'neutral' as const,
		variant: 'outline' as const,
		class: 'font-mono',
		onClick: () => emit('use-source', example.source),
	})),
)

const mistypedTable = computed(() =>
	props.failure ? unknownTable(props.failure.message) : null,
)
const suggestedTable = computed(() => {
	const mistyped = mistypedTable.value
	const schema = props.schemas.find(
		(candidate) => candidate.id === props.target.schema,
	)
	if (!mistyped || !schema) return null
	return closestTable(
		mistyped,
		schema.tables.map((table) => table.name),
	)
})
</script>

<template>
	<DmsCard :padded="false" class="overflow-hidden">
		<div
			class="border-default flex flex-wrap items-center gap-2.5 border-b px-4 py-2.5"
		>
			<UIcon
				:name="failure ? 'i-ph-x-circle' : 'i-ph-check-circle'"
				:class="
					failure ? 'text-error' : result ? 'text-success' : 'text-dimmed'
				"
				class="size-4"
			/>
			<b class="text-highlighted text-sm">
				{{ t('dms_database.query.result.title') }}
			</b>
			<template v-if="result">
				<UBadge
					:color="result.mutation ? 'info' : 'success'"
					variant="soft"
					size="sm"
					class="font-mono"
				>
					{{
						result.mutation
							? t(
									'dms_database.query.result.changed',
									{ count: n(result.rowCount) },
									result.rowCount,
								)
							: t(
									'dms_database.query.result.rows',
									{ count: n(result.rowCount) },
									result.rowCount,
								)
					}}
				</UBadge>
				<span class="text-dimmed font-mono text-xs">
					{{ result.durationMs }} ms ·
					{{
						result.mutation
							? t('dms_database.query.result.wrote')
							: t('dms_database.query.result.read_only')
					}}
					<template v-if="targetLabel">· {{ targetLabel }}</template>
				</span>
			</template>
			<div
				v-if="result && rows.length > 0"
				class="ml-auto flex items-center gap-1.5"
			>
				<DmsSegmented
					v-model="mode"
					:items="modeItems"
					size="sm"
					:aria-label="t('dms_database.query.result.title')"
				/>
				<UTooltip :text="t('dms_database.query.result.copy')">
					<UButton
						icon="i-ph-copy"
						color="neutral"
						variant="ghost"
						size="sm"
						:aria-label="t('dms_database.query.result.copy')"
						@click="copyJson"
					/>
				</UTooltip>
				<UButton
					icon="i-ph-download-simple"
					color="neutral"
					variant="outline"
					size="sm"
					:label="t('dms_database.query.result.export')"
					@click="exportCsv"
				/>
			</div>
		</div>

		<div class="min-h-56">
			<div v-if="failure" class="grid gap-3 p-4">
				<div class="border-error/40 bg-error/10 rounded-lg border px-4 py-3">
					<p class="text-error text-sm font-semibold">
						{{ t('dms_database.query.result.failed_title') }}
					</p>
					<p class="text-muted text-xs">
						{{
							t('dms_database.query.result.failed_detail', {
								ms: failure.durationMs,
							})
						}}
					</p>
					<p
						class="text-toned mt-2 whitespace-pre-wrap font-mono text-[12.5px]"
					>
						{{ failure.message }}
					</p>
				</div>
				<div v-if="mistypedTable" class="flex flex-wrap gap-2">
					<UButton
						v-if="suggestedTable"
						size="sm"
						icon="i-ph-arrow-right"
						:label="
							t('dms_database.query.result.replace', { table: suggestedTable })
						"
						@click="emit('replace-table', mistypedTable, suggestedTable)"
					/>
					<UButton
						v-if="target.schema"
						size="sm"
						color="neutral"
						variant="ghost"
						:label="
							t('dms_database.query.result.see_tables', {
								schema: target.schema,
							})
						"
						:to="`${DATABASE_PAGES.schemas}?tab=schema-${target.schema}`"
					/>
				</div>
			</div>

			<div v-else-if="!result" class="grid place-items-center p-8">
				<DmsEmptyState
					icon="i-ph-play"
					:title="t('dms_database.query.result.first_title')"
					:description="
						examples.length
							? t('dms_database.query.result.first_description')
							: undefined
					"
					:actions="exampleActions"
				/>
			</div>

			<div v-else-if="rows.length === 0" class="grid place-items-center p-8">
				<DmsEmptyState
					size="sm"
					:title="
						result.mutation
							? t('dms_database.query.result.done')
							: t('dms_database.query.result.no_rows')
					"
				/>
			</div>

			<div v-else-if="mode === 'table'" class="max-h-[28rem] overflow-auto">
				<table class="w-full text-sm">
					<thead class="bg-elevated sticky top-0">
						<tr class="border-default border-b text-left">
							<th
								v-for="column in columns"
								:key="column"
								class="text-dimmed whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold"
							>
								{{ column }}
							</th>
							<th v-if="browsable" class="w-8" />
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="(row, rowIndex) in shownRows"
							:key="rowIndex"
							class="group/result border-default/60 hover:bg-elevated/40 border-b last:border-0"
						>
							<td
								v-for="column in columns"
								:key="column"
								class="max-w-80 truncate whitespace-nowrap px-3 py-1.5 font-mono text-[12.5px]"
								:class="[
									row[column] === null || row[column] === undefined
										? 'text-dimmed'
										: 'text-toned',
									typeof row[column] === 'number'
										? 'text-right tabular-nums'
										: '',
								]"
							>
								{{ renderCell(row[column]) }}
							</td>
							<td v-if="browsable" class="px-1">
								<UButton
									v-if="rowLink(row)"
									:to="rowLink(row) ?? undefined"
									icon="i-ph-arrow-square-out"
									color="neutral"
									variant="ghost"
									size="xs"
									class="opacity-0 focus-visible:opacity-100 group-hover/result:opacity-100"
									:aria-label="t('dms_database.query.result.open_row')"
									:title="t('dms_database.query.result.open_row')"
								/>
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			<pre
				v-else-if="mode === 'json'"
				class="text-toned max-h-[28rem] overflow-auto whitespace-pre p-4 font-mono text-xs"
				>{{ JSON.stringify(rows, null, 2) }}</pre
			>

			<div v-else class="grid gap-3 p-4">
				<div class="flex flex-wrap items-center gap-2">
					<DmsEyebrow :label="t('dms_database.query.result.bars')" />
					<USelect
						v-model="xColumn"
						:items="columns"
						size="xs"
						class="min-w-36 font-mono"
						:aria-label="t('dms_database.query.result.x_axis')"
					>
						<template #leading>
							<span class="text-dimmed text-[11px]">x</span>
						</template>
					</USelect>
					<USelect
						v-model="yColumn"
						:items="numericColumns"
						size="xs"
						class="min-w-36 font-mono"
						:aria-label="t('dms_database.query.result.y_axis')"
					>
						<template #leading>
							<span class="text-dimmed text-[11px]">y</span>
						</template>
					</USelect>
					<span v-if="rows.length > CHART_ROWS" class="text-dimmed text-xs">
						{{
							t('dms_database.query.result.chart_first', {
								count: CHART_ROWS,
								total: n(rows.length),
							})
						}}
					</span>
				</div>
				<DmsChart
					v-if="yColumn"
					type="bar"
					:static-dataset="chartDataset"
					color="primary"
					height="280px"
					:show-legend="false"
					xaxis-type="category"
				/>
				<DmsEmptyState
					v-else
					size="sm"
					icon="i-ph-chart-bar"
					:title="t('dms_database.query.result.chart_unavailable')"
				/>
			</div>
		</div>

		<div
			v-if="result && rows.length > 0"
			class="border-default text-muted flex flex-wrap items-center gap-2 border-t px-4 py-2 text-xs"
		>
			<UIcon
				:name="result.truncated ? 'i-ph-warning' : 'i-ph-info'"
				:class="result.truncated ? 'text-warning' : ''"
				class="size-3.5"
			/>
			<span v-if="result.truncated">
				{{
					t('dms_database.query.result.truncated', {
						shown: n(rows.length),
						total: n(result.rowCount),
					})
				}}
			</span>
			<span v-else-if="mode === 'table' && rows.length > MAX_TABLE_ROWS">
				{{
					t('dms_database.query.result.table_first', {
						shown: n(MAX_TABLE_ROWS),
						total: n(rows.length),
					})
				}}
			</span>
			<span v-else>
				{{
					t(
						'dms_database.query.result.all_shown',
						{ count: n(rows.length) },
						rows.length,
					)
				}}
			</span>
			<UButton
				v-if="tableBrowserLink"
				class="ml-auto"
				size="xs"
				color="neutral"
				variant="ghost"
				icon="i-ph-rows"
				:to="tableBrowserLink"
				:label="
					t('dms_database.query.result.open_table', { target: targetLabel })
				"
			/>
		</div>
	</DmsCard>
</template>

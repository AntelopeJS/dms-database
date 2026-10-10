<script setup lang="ts">
import { useQueryStore } from '../build/composables/useQueryStore'
import { useDatabaseSchemas } from '../build/composables/useDatabaseSchemas'
import { useSessionStorage } from '@vueuse/core'
import { h } from 'vue'
import { replaceName, type UnknownKind } from '../build/query/runs'
import {
	describeTarget,
	instanceArgument,
	readQueryTarget,
	targetFromSource,
	withInstance,
	type QueryTarget,
} from '../build/query/target'
import {
	prepareQueryPayload,
	QueryInputError,
} from '../build/composables/useQueryRuntime'
import type {
	DryRunResult,
	HistoryEntry,
	SavedQuery,
} from '../build/composables/useQueryStore'
import { schemaAccess } from '../build/utils/databaseLinks'
import QueryBuilderPanel from './QueryBuilderPanel.vue'
import QueryLibrary from './QueryLibrary.vue'
import QueryResultPanel, {
	type InstanceRows,
	type QueryFailure,
} from './QueryResultPanel.vue'

// The query console: the library rail, the editor and the result. A query
// that changes data runs only after a dry run told what it touches (D-03):
// deletes and multi-row writes ask for the table name; a single-row update
// can be let through without asking until the browser tab is closed.

const BROWSE_COUNT = '/api/database/browse/count'
// The query being written, kept for the browser tab: a reload, or a row link
// followed by Back, brings it back (Q-9). A link that names a query wins.
const DRAFT_KEY = 'dms-database:query:draft'
const SKIP_SINGLE_UPDATES_KEY = 'dms-database:query:skip-single-row-updates'
const PREFILL_ROWS = 50
const OPERATION_ICONS: Record<string, string> = {
	insert: 'i-ph-plus-circle',
	update: 'i-ph-pencil-simple',
	replace: 'i-ph-swap',
	delete: 'i-ph-trash',
}

const { t, n } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const { $authFetch } = useAuthFetch()
const { confirm } = useConfirm()
const toast = useToast()
const { user } = useUserSession()
const store = useQueryStore()
const { schemas } = useDatabaseSchemas()

const source = ref('')
const executing = ref(false)
const result = ref<Awaited<ReturnType<typeof store.executeQuery>> | null>(null)
const failure = ref<QueryFailure | null>(null)
const target = ref<QueryTarget>({})
const loadedSaved = ref<SavedQuery | null>(null)
const activeHistoryId = ref<string | null>(null)
const libraryLoading = ref(true)
// Named instances holding rows of a table the last read found empty in the
// default instance.
const elsewhere = ref<InstanceRows[]>([])
const team = ref<SavedQuery[]>([])
const editor = useTemplateRef<InstanceType<typeof QueryBuilderPanel>>('editor')

const edited = computed(
	() =>
		Boolean(loadedSaved.value) && loadedSaved.value?.source !== source.value,
)
const ownId = computed(
	() => (user.value as { _id?: string } | null)?._id ?? null,
)

// --- library ---
async function refreshHistory() {
	await store.fetchHistory().catch(() => undefined)
}

async function refreshSaved() {
	await store.fetchSaved('me').catch(() => undefined)
	try {
		const res = await $authFetch<{ items: SavedQuery[] }>(
			'/api/database/query/saved',
			{
				query: { scope: 'shared' },
			},
		)
		team.value = res.items.filter((query) => query.userId !== ownId.value)
	} catch {
		team.value = []
	}
}

function openSaved(query: SavedQuery) {
	loadedSaved.value = query
	activeHistoryId.value = null
	source.value = query.source
}

function openHistory(entry: HistoryEntry) {
	loadedSaved.value = null
	activeHistoryId.value = entry.id
	source.value = entry.source
}

function newQuery() {
	loadedSaved.value = null
	activeHistoryId.value = null
	source.value = ''
	result.value = null
	failure.value = null
	nextTick(() => editor.value?.focus())
}

const draft = useSessionStorage<{ source: string; savedId: string | null }>(
	DRAFT_KEY,
	{ source: '', savedId: null },
)
watch([source, () => loadedSaved.value?.id ?? null], ([text, savedId]) => {
	draft.value = { source: text, savedId }
})

function restoreDraft() {
	const { source: text, savedId } = draft.value
	if (!text) return
	const saved = savedId
		? store.savedQueries.value.find((query) => query.id === savedId)
		: undefined
	loadedSaved.value = saved ?? null
	source.value = text
}

async function deleteSaved(query: SavedQuery) {
	const confirmed = await confirm({
		title: t('dms_database.query.delete.title', { name: query.name }),
		description: query.shared
			? t('dms_database.query.delete.shared')
			: undefined,
		confirmLabel: t('dms_database.query.delete.confirm'),
		color: 'error',
		icon: 'i-ph-trash',
	})
	if (!confirmed) return
	await store.deleteSaved(query.id).catch(() => undefined)
	if (loadedSaved.value?.id === query.id) loadedSaved.value = null
	await refreshSaved()
}

async function clearHistory() {
	const confirmed = await confirm({
		title: t('dms_database.query.clear.title'),
		description: t('dms_database.query.clear.description'),
		confirmLabel: t('dms_database.query.clear.confirm'),
		color: 'warning',
	})
	if (confirmed) await store.clearHistory().catch(() => undefined)
}

// --- running ---
function fetchMessage(error: unknown): string {
	const { data, message } = (error ?? {}) as {
		data?: unknown
		message?: unknown
	}
	const inner = (data as { message?: unknown } | null)?.message
	if (typeof inner === 'string' && inner) return inner
	if (typeof data === 'string' && data) return data
	return typeof message === 'string' && message
		? message
		: t('dms_database.query.result.failed_title')
}

/** How long the server ran a failed query, as its error says. */
function fetchDuration(error: unknown): number | null {
	const data = (error as { data?: unknown } | null)?.data
	const duration = (data as { durationMs?: unknown } | null)?.durationMs
	return typeof duration === 'number' ? duration : null
}

/**
 * The named instances of a table that hold rows, each with its count: asked
 * only when a read found the table empty in the default instance (decision
 * 11). An instance whose count fails is left out.
 */
async function instancesWithRows(target: QueryTarget): Promise<InstanceRows[]> {
	const instances =
		schemas.value.find((schema) => schema.id === target.schema)?.instances ?? []
	const counts = await Promise.all(
		instances.map((id) =>
			$authFetch<{ total: number }>(BROWSE_COUNT, {
				query: {
					filter_schema: `is:${target.schema}`,
					filter_table: `is:${target.table}`,
					filter_instance: `is:${id}`,
				},
			}).then(
				(res) => ({ id, count: res.total }),
				() => ({ id, count: 0 }),
			),
		),
	)
	return counts.filter((entry) => entry.count > 0)
}

// Each run drops the instances found for the previous one; a slow answer
// for an older run is ignored.
let runId = 0

async function findElsewhere(
	answer: Awaited<ReturnType<typeof store.executeQuery>>,
	next: QueryTarget,
) {
	const id = ++runId
	elsewhere.value = []
	if (
		answer.mutation ||
		answer.rows.length > 0 ||
		next.instance !== '' ||
		!next.schema ||
		!next.table
	)
		return
	const found = await instancesWithRows(next)
	if (id === runId) elsewhere.value = found
}

// The result keeps naming the previous run's target until the new one lands.
async function execute(query: Record<string, unknown>, text: string) {
	executing.value = true
	const next = readQueryTarget(query)
	try {
		const answer = await store.executeQuery(query, text, 'aql')
		failure.value = null
		result.value = answer
		void findElsewhere(answer, next)
	} catch (error) {
		result.value = null
		failure.value = {
			message: fetchMessage(error),
			durationMs: fetchDuration(error),
		}
	} finally {
		target.value = next
		executing.value = false
		activeHistoryId.value = null
		await refreshHistory()
	}
}

/** A run that failed before the server ran it, worded for the reader. */
function describeInputError(error: unknown): QueryFailure {
	if (!(error instanceof QueryInputError))
		return {
			message:
				error instanceof Error && error.message
					? error.message
					: t('dms_database.query.result.failed_title'),
			durationMs: null,
		}
	const { problem } = error
	if (problem.kind === 'unknown_schema')
		return {
			message: t('dms_database.query.errors.unknown_schema', {
				schema: problem.schema,
			}),
			durationMs: null,
			unknown: { kind: 'schema', name: problem.schema },
		}
	const { place, detail } = problem
	return {
		message: place
			? t('dms_database.query.errors.syntax_at', { ...place })
			: t('dms_database.query.errors.syntax', { detail }),
		durationMs: null,
	}
}

// A run that never reached the server is not kept in History (decision 9).
function failBeforeRun(text: string, problem: QueryFailure) {
	result.value = null
	elsewhere.value = []
	failure.value = problem
	target.value = targetFromSource(text)
	activeHistoryId.value = null
}

function skipsSingleUpdates(): boolean {
	return (
		typeof window !== 'undefined' &&
		window.sessionStorage.getItem(SKIP_SINGLE_UPDATES_KEY) === 'true'
	)
}

function isSingleRowUpdate(dry: DryRunResult): boolean {
	return (
		(dry.operation === 'update' || dry.operation === 'replace') &&
		dry.rows === 1
	)
}

function guardTexts(dry: DryRunResult) {
	const rows = dry.rows ?? 0
	// The whole target, schema and instance included: `demo.tags @eu`.
	const table = describeTarget(dry) || (dry.table ?? '')
	const unknown = dry.rows === null
	return {
		title: unknown
			? t('dms_database.query.guard.title_unknown', { table })
			: t(
					`dms_database.query.guard.title_${dry.operation}`,
					{ table, count: n(rows) },
					rows,
				),
		confirmLabel: unknown
			? t('dms_database.query.guard.confirm_unknown')
			: t(
					`dms_database.query.guard.confirm_${dry.operation}`,
					{ count: n(rows) },
					rows,
				),
	}
}

async function guard(query: Record<string, unknown>, text: string) {
	let dry: DryRunResult
	try {
		dry = await store.dryRun(query)
	} catch (error) {
		return failBeforeRun(text, {
			message: fetchMessage(error),
			durationMs: null,
		})
	}
	if (dry.operation === 'read') return execute(query, text)
	if (isSingleRowUpdate(dry) && skipsSingleUpdates())
		return execute(query, text)
	const skipNextTime = ref(false)
	const typed =
		dry.operation === 'delete' || dry.rows === null || (dry.rows ?? 0) > 1
	const targetLabel = describeTarget(dry)
	const texts = guardTexts(dry)
	await confirm({
		...texts,
		description: t('dms_database.query.guard.description'),
		color: dry.operation === 'delete' ? 'error' : 'warning',
		icon: OPERATION_ICONS[dry.operation] ?? 'i-ph-warning',
		initialFocus: 'cancel',
		confirmText: typed ? (dry.table ?? dry.schema) : undefined,
		impact: [
			{
				icon: OPERATION_ICONS[dry.operation] ?? 'i-ph-lightning',
				label: t('dms_database.query.guard.operation'),
				count: t(`dms_database.query.guard.op_${dry.operation}`),
			},
			{
				icon: 'i-ph-table',
				label: t('dms_database.query.guard.target'),
				count: targetLabel,
			},
			{
				icon: 'i-ph-rows',
				label: t('dms_database.query.guard.rows'),
				count: dry.rows === null ? '?' : n(dry.rows),
			},
		],
		body: () =>
			h('div', { class: 'grid gap-3' }, [
				h(
					'pre',
					{
						class:
							'border-default bg-elevated/50 max-h-40 overflow-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]',
					},
					text,
				),
				isSingleRowUpdate(dry)
					? h('label', { class: 'flex items-start gap-2 text-sm' }, [
							h('input', {
								type: 'checkbox',
								class: 'mt-1',
								checked: skipNextTime.value,
								onChange: (event: Event) => {
									skipNextTime.value = (
										event.target as HTMLInputElement
									).checked
								},
							}),
							h('span', [
								h(
									'span',
									{ class: 'text-toned' },
									t('dms_database.query.guard.skip'),
								),
								h(
									'span',
									{ class: 'text-dimmed block text-xs' },
									t('dms_database.query.guard.skip_detail'),
								),
							]),
						])
					: null,
			]),
		onConfirm: async () => {
			if (skipNextTime.value)
				window.sessionStorage.setItem(SKIP_SINGLE_UPDATES_KEY, 'true')
			await execute(query, text)
		},
	})
}

async function run() {
	if (!source.value.trim() || executing.value) return
	let prepared: ReturnType<typeof prepareQueryPayload>
	try {
		prepared = prepareQueryPayload(source.value, schemas.value)
	} catch (error) {
		return failBeforeRun(source.value.trim(), describeInputError(error))
	}
	if (prepared.hasMutations) await guard(prepared.query, prepared.source)
	else await execute(prepared.query, prepared.source)
}

function replaceUnknown(kind: UnknownKind, from: string, to: string) {
	source.value = replaceName(source.value, kind, from, to)
	failure.value = null
}

// The empty read again, in a named instance that has rows.
async function runInInstance(instance: string) {
	if (!target.value.schema) return
	const next = withInstance(source.value, target.value.schema, instance)
	if (next === source.value) return
	source.value = next
	await run()
}

// --- saving ---
const saveOpen = ref(false)
const saveName = ref('')
const saveDescription = ref('')
const saveShared = ref(false)
const saveError = ref<string | null>(null)
const saving = ref(false)
const editing = ref<SavedQuery | null>(null)
// A past run being saved: the editor takes its text once it is saved.
const savingRun = ref<HistoryEntry | null>(null)

function openSaveModal(from?: SavedQuery | HistoryEntry) {
	const saved = from && 'name' in from ? from : null
	editing.value = saved
	savingRun.value = from && !saved ? (from as HistoryEntry) : null
	saveName.value = saved?.name ?? ''
	saveDescription.value = saved?.description ?? ''
	saveShared.value = saved?.shared ?? false
	saveError.value = null
	saveOpen.value = true
}

async function persist(text: string) {
	const payload = prepareQueryPayload(text, schemas.value)
	const input = {
		name: saveName.value.trim(),
		description: saveDescription.value.trim(),
		query: payload.query,
		source: payload.source,
		language: 'aql' as const,
		shared: saveShared.value,
	}
	return editing.value
		? store.updateSaved(editing.value.id, input)
		: store.saveQuery(input)
}

async function confirmSave() {
	if (!saveName.value.trim()) return
	saving.value = true
	saveError.value = null
	try {
		const run = savingRun.value
		const text = run
			? run.source
			: editing.value && editing.value.id !== loadedSaved.value?.id
				? editing.value.source
				: source.value
		const saved = await persist(text)
		if (run || !editing.value || editing.value.id === loadedSaved.value?.id) {
			loadedSaved.value = saved
			activeHistoryId.value = null
			source.value = saved.source
		}
		savingRun.value = null
		saveOpen.value = false
		toast.add({
			title: t('dms_database.query.save.saved', { name: saved.name }),
			color: 'success',
			icon: 'i-ph-check',
		})
		await refreshSaved()
	} catch (error) {
		saveError.value =
			error instanceof Error && !('data' in error)
				? error.message
				: fetchMessage(error)
	} finally {
		saving.value = false
	}
}

// ⌘S on a query of the caller's own saves it in place; anything else asks a name.
async function save() {
	const own = loadedSaved.value
	if (!own || own.userId !== ownId.value) return openSaveModal()
	editing.value = own
	savingRun.value = null
	saveName.value = own.name
	saveDescription.value = own.description
	saveShared.value = own.shared
	await confirmSave()
}

// --- links into the console ---
/** Opens what the URL names; false when it names nothing to open. */
async function openFromRoute(): Promise<boolean> {
	const { q, source: linked, history, schema, table, instance } = route.query
	let opened = false
	if (typeof q === 'string') {
		const match =
			store.savedQueries.value.find((query) => query.id === q) ??
			team.value.find((query) => query.id === q)
		if (match) openSaved(match)
		opened = Boolean(match)
	} else if (typeof history === 'string') {
		const entry = await store.fetchHistoryEntry(history).catch(() => null)
		if (entry) openHistory(entry)
		opened = Boolean(entry)
	} else if (typeof linked === 'string') {
		newQuery()
		source.value = linked
		opened = true
	} else if (typeof schema === 'string' && typeof table === 'string') {
		newQuery()
		// The instance the link names: a named one, the default, or every one.
		source.value = `${schemaAccess(schema)}.instance(${instanceArgument(instance)}).table(${JSON.stringify(table)}).slice(0, ${PREFILL_ROWS})`
		opened = true
	} else {
		return false
	}
	router.replace({ query: {} })
	return opened
}

onMounted(async () => {
	await Promise.all([refreshHistory(), refreshSaved()])
	libraryLoading.value = false
	if (!(await openFromRoute())) restoreDraft()
})
</script>

<template>
	<!-- Below lg the cards stack at their own height and the page scrolls; a
	     card never shrinks under its content. -->
	<div
		class="flex min-h-0 flex-1 flex-col gap-4 max-lg:overflow-y-auto lg:grid lg:grid-cols-[19rem_minmax(0,1fr)]"
	>
		<QueryLibrary
			class="max-lg:max-h-80 max-lg:shrink-0 lg:min-h-0"
			:history="store.historyItems.value"
			:saved="store.savedQueries.value"
			:team="team"
			:active-saved-id="loadedSaved?.id ?? null"
			:active-history-id="activeHistoryId"
			:loading="libraryLoading"
			@open-history="openHistory"
			@save-history="openSaveModal"
			@open-saved="openSaved"
			@edit-saved="openSaveModal"
			@delete-saved="deleteSaved"
			@clear-history="clearHistory"
		/>

		<div
			class="flex min-w-0 flex-col gap-4 max-lg:shrink-0 lg:min-h-0 lg:overflow-y-auto"
		>
			<QueryBuilderPanel
				ref="editor"
				v-model="source"
				class="shrink-0"
				:executing="executing"
				:schemas="schemas"
				:saved-name="loadedSaved?.name"
				:saved-shared="loadedSaved?.shared"
				:edited="edited"
				@execute="run"
				@save="save"
				@new="newQuery"
			/>
			<QueryResultPanel
				class="shrink-0"
				:result="result"
				:failure="failure"
				:target="target"
				:schemas="schemas"
				:running="executing"
				:elsewhere="elsewhere"
				@use-source="source = $event"
				@replace-name="replaceUnknown"
				@use-instance="runInInstance"
			/>
		</div>

		<UModal
			v-model:open="saveOpen"
			:title="
				editing
					? t('dms_database.query.save.edit_title')
					: t('dms_database.query.save.title')
			"
			:description="t('dms_database.query.save.description')"
		>
			<template #body>
				<form
					id="dms-database-save-query"
					class="grid gap-4"
					@submit.prevent="confirmSave"
				>
					<UFormField :label="t('dms_database.query.save.name')" required>
						<UInput
							v-model="saveName"
							autofocus
							class="w-full"
							:placeholder="t('dms_database.query.save.name_placeholder')"
						/>
					</UFormField>
					<UFormField
						:label="t('dms_database.query.save.notes')"
						:hint="t('dms_database.query.save.optional')"
					>
						<UTextarea v-model="saveDescription" class="w-full" :rows="3" />
					</UFormField>
					<USwitch
						v-model="saveShared"
						:label="t('dms_database.query.save.share')"
						:description="t('dms_database.query.save.share_description')"
					/>
					<UAlert
						v-if="saveError"
						color="error"
						variant="subtle"
						icon="i-ph-warning"
						:title="t('dms_database.query.save.failed')"
						:description="saveError"
					/>
				</form>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton
						color="neutral"
						variant="outline"
						:disabled="saving"
						:label="t('dms_database.common.cancel')"
						@click="saveOpen = false"
					/>
					<UButton
						type="submit"
						form="dms-database-save-query"
						:loading="saving"
						:disabled="!saveName.trim()"
						:label="t('dms_database.query.save.confirm')"
					/>
				</div>
			</template>
		</UModal>
	</div>
</template>

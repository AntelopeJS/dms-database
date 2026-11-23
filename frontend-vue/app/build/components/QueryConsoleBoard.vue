<script setup lang="ts">
import { useQueryStore } from '../composables/useQueryStore'
import { isText } from '../utils/values'
import { useDatabaseSchemas } from '../composables/useDatabaseSchemas'
import { useElsewhereInstances } from '../composables/useElsewhereInstances'
import { useSessionStorage } from '@vueuse/core'
import { h } from 'vue'
import { replaceName, type UnknownKind } from '../query/runs'
import { sqlFailure } from '../query/failures'
import {
	describeTarget,
	instanceArgument,
	readQueryTarget,
	targetFromSource,
	withInstance,
	type QueryTarget,
} from '../query/target'
import {
	prepareQueryPayload,
	QueryInputError,
} from '../composables/useQueryRuntime'
import type {
	DryRunResult,
	HistoryEntry,
	SavedQuery,
} from '../composables/useQueryStore'
import { schemaAccess } from '../utils/databaseLinks'
import QueryBuilderPanel from '../../components/QueryBuilderPanel.vue'
import QueryLibrary from '../../components/QueryLibrary.vue'
import QueryResultPanel, {
	type QueryFailure,
} from '../../components/QueryResultPanel.vue'

const DRAFT_KEY = 'dms-database:query:draft'
const PREFILL_ROWS = 50
const OPERATION_ICONS = new Map([
	['insert', 'i-ph-plus-circle'],
	['update', 'i-ph-pencil-simple'],
	['replace', 'i-ph-swap'],
	['delete', 'i-ph-trash'],
])

type QueryDocument = SavedQuery['query']

const { t, n } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const { confirm } = useConfirm()
const toast = useToast()
const errorPresenter = useApiErrorPresenter()
const { user } = useDmsUserSession<{ _id?: string }>()
const store = useQueryStore()
const { schemas, ready: schemasRead } = useDatabaseSchemas()

const source = ref('')
const executing = ref(false)
const result = ref<Awaited<ReturnType<typeof store.executeQuery>> | null>(null)
const failure = ref<QueryFailure | null>(null)
const target = ref<QueryTarget>({})
const loadedSaved = ref<SavedQuery | null>(null)
const activeHistoryId = ref<string | null>(null)
const { elsewhere, findElsewhere } = useElsewhereInstances(schemas)
const editor = useTemplateRef<InstanceType<typeof QueryBuilderPanel>>('editor')

const edited = computed(
	() =>
		Boolean(loadedSaved.value) && loadedSaved.value?.source !== source.value,
)
const ownId = computed(() => user.value?._id ?? null)

const team = computed(() =>
	store.sharedQueries.value.filter((query) => query.userId !== ownId.value),
)

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
	void nextTick(() => editor.value?.focus())
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
	try {
		await store.deleteSaved(query.id)
	} catch (error) {
		errorPresenter.presentError(error, {
			fallbackKey: 'dms.action_error.generic',
		})
		return
	}
	if (loadedSaved.value?.id === query.id) loadedSaved.value = null
	await store.refreshSaved()
}

async function clearHistory() {
	const confirmed = await confirm({
		title: t('dms_database.query.clear.title'),
		description: t('dms_database.query.clear.description'),
		confirmLabel: t('dms_database.query.clear.confirm'),
		color: 'warning',
	})
	if (confirmed)
		await store.clearHistory().catch((error: unknown) => {
			errorPresenter.presentError(error, {
				fallbackKey: 'dms.action_error.generic',
			})
		})
}

async function execute(query: QueryDocument, text: string) {
	executing.value = true
	const next = readQueryTarget(query)
	try {
		const answer = await store.executeQuery(query, text, 'aql')
		failure.value = null
		result.value = answer
		void findElsewhere(answer, next)
	} catch (error) {
		result.value = null
		failure.value = sqlFailure(error)
		if (!failure.value)
			errorPresenter.presentError(error, {
				fallbackKey: 'dms_database.query.result.failed_title',
			})
	} finally {
		target.value = next
		executing.value = false
		activeHistoryId.value = null
		await store.refreshHistory()
	}
}

/** A run that failed before the server ran it, worded for the reader. */
function describeInputError(error: Error | null): QueryFailure {
	if (!(error instanceof QueryInputError))
		return {
			message: error?.message || t('dms_database.query.result.failed_title'),
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

function failBeforeRun(text: string, problem: QueryFailure) {
	result.value = null
	elsewhere.value = []
	failure.value = problem
	target.value = targetFromSource(text)
	activeHistoryId.value = null
}

function guardTexts(dry: DryRunResult) {
	const rows = dry.rows ?? 0
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

async function guard(query: QueryDocument, text: string) {
	let dry: DryRunResult
	try {
		dry = await store.dryRun(query)
	} catch (error) {
		const diagnostic = sqlFailure(error)
		if (diagnostic) return failBeforeRun(text, diagnostic)
		errorPresenter.presentError(error, {
			fallbackKey: 'dms_database.query.result.failed_title',
		})
		return
	}
	if (dry.operation === 'read') return execute(query, text)
	const targetLabel = describeTarget(dry)
	const texts = guardTexts(dry)
	await confirm({
		...texts,
		description: t('dms_database.query.guard.description'),
		color: dry.operation === 'delete' ? 'error' : 'warning',
		icon: OPERATION_ICONS.get(dry.operation) ?? 'i-ph-warning',
		initialFocus: 'cancel',
		confirmText: dry.table ?? dry.schema,
		impact: [
			{
				icon: OPERATION_ICONS.get(dry.operation) ?? 'i-ph-lightning',
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
			h(
				'pre',
				{
					class:
						'border-default bg-elevated/50 max-h-40 overflow-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]',
				},
				text,
			),
		onConfirm: () => execute(query, text),
	})
}

async function run() {
	if (!source.value.trim() || executing.value) return
	let prepared: ReturnType<typeof prepareQueryPayload>
	try {
		prepared = prepareQueryPayload(source.value, schemas.value)
	} catch (error) {
		return failBeforeRun(
			source.value.trim(),
			describeInputError(error instanceof Error ? error : null),
		)
	}
	if (prepared.hasMutations) await guard(prepared.query, prepared.source)
	else await execute(prepared.query, prepared.source)
}

function replaceUnknown(kind: UnknownKind, from: string, to: string) {
	source.value = replaceName(source.value, kind, from, to)
	failure.value = null
}

async function runInInstance(instance: string) {
	if (!target.value.schema) return
	const next = withInstance(source.value, target.value.schema, instance)
	if (next === source.value) return
	source.value = next
	await run()
}

const saveOpen = ref(false)
const saveName = ref('')
const saveDescription = ref('')
const saveShared = ref(false)
const saveError = ref<string | null>(null)
const nameTouched = ref(false)
const nameError = computed(() =>
	nameTouched.value && !saveName.value.trim()
		? t('dms_database.query.save.name_required')
		: null,
)
const SAVE_ROW = { layout: 'form', inset: false, spacing: 'row' } as const
const saving = ref(false)
const editing = ref<SavedQuery | null>(null)
const savingRun = ref<HistoryEntry | null>(null)

function openSaveModal(from?: SavedQuery | HistoryEntry) {
	const saved = from && 'name' in from ? from : null
	editing.value = saved
	savingRun.value = from && !('name' in from) ? from : null
	saveName.value = saved?.name ?? ''
	saveDescription.value = saved?.description ?? ''
	saveShared.value = saved?.shared ?? false
	saveError.value = null
	nameTouched.value = false
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
	if (!saveName.value.trim()) {
		nameTouched.value = true
		return
	}
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
		await store.refreshSaved()
	} catch (error) {
		if (error instanceof QueryInputError) saveError.value = error.message
		else
			errorPresenter.presentError(error, {
				fallbackKey: 'dms_database.query.save.failed',
			})
	} finally {
		saving.value = false
	}
}

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

/** Opens what the URL names; false when it names nothing to open. */
async function openFromRoute(): Promise<boolean> {
	const { q, source: linked, history, schema, table, instance } = route.query
	let opened = false
	if (isText(q)) {
		const match =
			store.savedQueries.value.find((query) => query.id === q) ??
			team.value.find((query) => query.id === q)
		if (match) openSaved(match)
		opened = Boolean(match)
	} else if (isText(history)) {
		const entry = await store.fetchHistoryEntry(history).catch(() => null)
		if (entry) openHistory(entry)
		opened = Boolean(entry)
	} else if (isText(linked)) {
		newQuery()
		source.value = linked
		opened = true
	} else if (isText(schema) && isText(table)) {
		newQuery()
		source.value = `${schemaAccess(schema)}.instance(${instanceArgument(instance)}).table(${JSON.stringify(table)}).slice(0, ${PREFILL_ROWS})`
		opened = true
	} else {
		return false
	}
	void router.replace({ query: {} })
	return opened
}

onMounted(async () => {
	await store.libraryRead
	if (!(await openFromRoute())) restoreDraft()
})

await Promise.all([schemasRead, store.libraryRead])
</script>

<template>
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
			:loading="store.libraryLoading.value"
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
					class="flex flex-col py-1"
					novalidate
					@submit.prevent="confirmSave"
				>
					<DmsFieldRow
						v-bind="SAVE_ROW"
						:label="t('dms_database.query.save.name')"
						label-for="dms-database-save-query-name"
						required
					>
						<div class="grid min-w-0 gap-1.5">
							<UFormField name="name" :error="nameError ?? false">
								<DmsInputText
									id="dms-database-save-query-name"
									v-model="saveName"
									autofocus
									class="w-full"
									:placeholder="t('dms_database.query.save.name_placeholder')"
									@blur="nameTouched = true"
								/>
								<template v-if="nameError" #error="{ error }">
									<DmsFormErrorText :error />
								</template>
							</UFormField>
						</div>
					</DmsFieldRow>
					<DmsFieldRow
						v-bind="SAVE_ROW"
						:label="t('dms_database.query.save.notes')"
						label-for="dms-database-save-query-description"
					>
						<DmsInputTextarea
							id="dms-database-save-query-description"
							v-model="saveDescription"
							class="w-full"
							:rows="3"
						/>
					</DmsFieldRow>
					<DmsFieldRow
						v-bind="SAVE_ROW"
						:label="t('dms_database.query.save.share')"
						:description="t('dms_database.query.save.share_description')"
						label-for="dms-database-save-query-shared"
					>
						<DmsInputSwitch
							id="dms-database-save-query-shared"
							v-model="saveShared"
						/>
					</DmsFieldRow>
					<DmsFormRequiredLegend class="pb-2" />
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

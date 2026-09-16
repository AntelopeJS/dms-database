<script setup lang="ts">
import { prepareQueryPayload } from "../../composables/useQueryRuntime";
import type {
	ExecuteResult,
	HistoryEntry,
	QueryLanguage,
	QueryScope,
	SavedQuery,
} from "../../composables/useQueryStore";

const HISTORY_PAGE_SIZE = 5;
const MUTATION_SKIP_KEY = "dms-db-query.skipMutationWarning";

const route = useDmsRoute();
const router = useDmsRouter();

const {
	savedQueries,
	historyItems,
	historyTotal,
	fetchSaved,
	fetchHistory,
	executeQuery,
	saveQuery,
	updateSaved,
	deleteSaved,
} = useQueryStore();

const { schemas: dbSchemas, refresh: refreshSchemas } = useDatabaseSchemas();

const DATA_PATH = "/modules/database/data";

const queryText = ref<string>("");
const language = ref<QueryLanguage>("aql");
const lastResult = ref<ExecuteResult | null>(null);
const resultMode = ref<"table" | "json" | "chart">("table");
const executing = ref(false);

const savedScope = ref<QueryScope>("me");
const historyPage = ref(0);

const saveModalOpen = ref(false);
const saveName = ref("");
const saveDescription = ref("");
const saveShared = ref(false);
const saving = ref(false);
// Non-null while the save modal edits an existing saved query instead of
// creating a new one. The modal works on its own snapshot of the source and
// language, so it never clobbers (or depends on) the main editor.
const editingSaved = ref<SavedQuery | null>(null);
const saveSource = ref("");
const saveLanguage = ref<QueryLanguage>("aql");
const saveError = ref<string | null>(null);

const mutationModalOpen = ref(false);
const mutationDontRemind = ref(false);
let pendingPayload: { query: Record<string, unknown>; source: string } | null =
	null;

async function refreshSaved() {
	try {
		await fetchSaved(savedScope.value);
	} catch {
		savedQueries.value = [];
	}
}

async function refreshHistory() {
	try {
		await fetchHistory(
			HISTORY_PAGE_SIZE,
			historyPage.value * HISTORY_PAGE_SIZE,
		);
	} catch {
		historyItems.value = [];
		historyTotal.value = 0;
	}
}

watch(savedScope, refreshSaved);
watch(historyPage, refreshHistory);

function loadFromSaved(saved: SavedQuery) {
	queryText.value = saved.source;
	language.value = saved.language;
}

function loadFromHistory(entry: HistoryEntry) {
	queryText.value = entry.source;
	language.value = entry.language;
}

function saveFromHistory(entry: HistoryEntry) {
	loadFromHistory(entry);
	openSaveModal();
}

function setError(message: string) {
	lastResult.value = {
		rows: [],
		executedAt: new Date().toISOString(),
		durationMs: 0,
		error: message,
	};
}

function extractFetchError(err: unknown): string {
	const { data, message } = (err ?? {}) as { data?: unknown; message?: unknown };
	if (typeof data === "string" && data.length > 0) return data;
	if (data && typeof data === "object") {
		const inner = (data as { message?: unknown; error?: unknown }).message
			?? (data as { message?: unknown; error?: unknown }).error;
		if (typeof inner === "string" && inner.length > 0) return inner;
	}
	if (typeof message === "string" && message.length > 0) return message;
	return "Query execution failed";
}

async function runPrepared(query: Record<string, unknown>, source: string) {
	executing.value = true;
	try {
		const result = await executeQuery(query, source, language.value);
		lastResult.value = result;
		await refreshHistory();
	} catch (err) {
		setError(extractFetchError(err));
	} finally {
		executing.value = false;
	}
}

async function onExecute() {
	if (!queryText.value.trim() || executing.value) return;

	let prepared: ReturnType<typeof prepareQueryPayload>;
	try {
		prepared = prepareQueryPayload(queryText.value, dbSchemas.value);
	} catch (err) {
		setError((err as Error).message);
		return;
	}

	const skip =
		typeof window !== "undefined" &&
		window.localStorage?.getItem(MUTATION_SKIP_KEY) === "true";
	if (prepared.hasMutations && !skip) {
		pendingPayload = { query: prepared.query, source: prepared.source };
		mutationDontRemind.value = false;
		mutationModalOpen.value = true;
		return;
	}

	await runPrepared(prepared.query, prepared.source);
}

async function confirmMutation() {
	const payload = pendingPayload;
	pendingPayload = null;
	mutationModalOpen.value = false;
	if (mutationDontRemind.value && typeof window !== "undefined") {
		window.localStorage?.setItem(MUTATION_SKIP_KEY, "true");
	}
	if (payload) {
		await runPrepared(payload.query, payload.source);
	}
}

function cancelMutation() {
	pendingPayload = null;
	mutationModalOpen.value = false;
}

function openSaveModal() {
	editingSaved.value = null;
	saveName.value = "";
	saveDescription.value = "";
	saveShared.value = false;
	// Snapshot the editor state; confirmSave only reads modal refs.
	saveSource.value = queryText.value;
	saveLanguage.value = language.value;
	saveError.value = null;
	saveModalOpen.value = true;
}

// Editing reuses the save modal: open it blank, then overlay the item.
function openEditModal(item: SavedQuery) {
	openSaveModal();
	editingSaved.value = item;
	saveName.value = item.name;
	saveDescription.value = item.description;
	saveShared.value = item.shared;
	saveSource.value = item.source;
	saveLanguage.value = item.language;
}

async function confirmSave() {
	const name = saveName.value.trim();
	if (!name) return;

	// A metadata-only edit reuses the stored payload — re-preparing would
	// needlessly re-evaluate the source and fail when the query's schema is
	// no longer registered.
	const editing = editingSaved.value;
	let payload: { query: Record<string, unknown>; source: string };
	if (editing && saveSource.value === editing.source) {
		payload = { query: editing.query, source: editing.source };
	} else {
		try {
			payload = prepareQueryPayload(saveSource.value, dbSchemas.value);
		} catch (err) {
			saveError.value = (err as Error).message;
			return;
		}
	}

	saving.value = true;
	saveError.value = null;
	try {
		const input = {
			name,
			description: saveDescription.value.trim(),
			query: payload.query,
			source: payload.source,
			language: saveLanguage.value,
			shared: saveShared.value,
		};
		if (editing) {
			await updateSaved(editing.id, input);
		} else {
			await saveQuery(input);
		}
		saveModalOpen.value = false;
		await refreshSaved();
	} catch (err) {
		saveError.value = extractFetchError(err);
	} finally {
		saving.value = false;
	}
}

async function onDeleteSaved(id: string) {
	try {
		await deleteSaved(id);
		await refreshSaved();
	} catch {
		// swallow — re-fetch ensures the UI is consistent
		await refreshSaved();
	}
}

onMounted(async () => {
	await Promise.all([refreshSaved(), refreshHistory(), refreshSchemas()]);
	const queryParam = route.query.q;
	const targetId = typeof queryParam === "string" ? queryParam : null;
	if (targetId) {
		const match = savedQueries.value.find((q) => q.id === targetId);
		if (match) loadFromSaved(match);
	}
	// A raw DSL snippet forwarded from the data browser ("Open in query console")
	// prefills the editor directly.
	const sourceParam = route.query.source;
	const prefill = typeof sourceParam === "string" ? sourceParam : null;
	if (prefill) queryText.value = prefill;
	if (targetId || prefill) {
		router.replace({ query: { ...route.query, q: undefined, source: undefined } });
	}
});
</script>

<template>
	<div class="space-y-6 pb-6">
		<section class="flex flex-wrap items-center gap-4 pt-6 pb-2">
			<div
				class="rounded-lg bg-primary/10 shadow-sm shrink-0 ring ring-primary/20 flex items-center justify-center size-12"
			>
				<UIcon name="i-ph-code" class="text-primary" size="1.75rem" />
			</div>
			<div class="flex-1 min-w-0">
				<h1 class="text-highlighted font-semibold">
					{{ $t("dms_database.query.title") }}
				</h1>
				<p class="text-muted text-sm">
					{{ $t("dms_database.query.description") }}
				</p>
			</div>
			<UButton
				:to="DATA_PATH"
				color="neutral"
				variant="ghost"
				icon="i-ph-table"
				:label="$t('dms_database.query.backToData')"
				class="ml-auto"
			/>
		</section>

		<div class="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-5 items-start">
			<aside class="flex flex-col gap-5 lg:sticky lg:top-6 lg:max-h-[calc(100vh-6rem)]">
				<DmsDatabaseQueryHistoryPanel
					v-model:page="historyPage"
					:items="historyItems"
					:total="historyTotal"
					:page-size="HISTORY_PAGE_SIZE"
					class="flex-1 min-h-0 max-h-96"
					@load="loadFromHistory"
					@save="saveFromHistory"
				/>
				<DmsDatabaseQueryFavoritesPanel
					v-model:scope="savedScope"
					:items="savedQueries"
					class="flex-1 min-h-0 max-h-80"
					@load="loadFromSaved"
					@edit="openEditModal"
					@delete="onDeleteSaved"
				/>
			</aside>

			<div class="flex flex-col gap-5 min-w-0">
				<DmsDatabaseQueryBuilderPanel
					v-model="queryText"
					v-model:language="language"
					:executing="executing"
					:schemas="dbSchemas"
					@execute="onExecute"
					@save="openSaveModal"
				/>
				<DmsDatabaseQueryResultPanel
					v-model:mode="resultMode"
					:result="lastResult"
				/>
			</div>
		</div>

		<UModal
			v-model:open="saveModalOpen"
			:title="
				editingSaved
					? $t('dms_database.query.editModal.title')
					: $t('dms_database.query.saveModal.title')
			"
		>
			<template #body>
				<div class="space-y-4">
					<UFormField :label="$t('dms_database.query.saveModal.name')" required>
						<UInput
							v-model="saveName"
							autofocus
							class="w-full"
							:placeholder="$t('dms_database.query.saveModal.namePlaceholder')"
						/>
					</UFormField>
					<UFormField :label="$t('dms_database.query.saveModal.description')">
						<UTextarea
							v-model="saveDescription"
							class="w-full"
							:placeholder="$t('dms_database.query.saveModal.descriptionPlaceholder')"
							:rows="3"
						/>
					</UFormField>
					<UFormField
						v-if="editingSaved"
						:label="$t('dms_database.query.editModal.query')"
					>
						<UTextarea
							v-model="saveSource"
							class="w-full font-mono"
							:rows="4"
						/>
					</UFormField>
					<UCheckbox
						v-model="saveShared"
						:label="$t('dms_database.query.saveModal.share')"
						:description="$t('dms_database.query.saveModal.shareDescription')"
					/>
					<UAlert
						v-if="saveError"
						color="error"
						variant="subtle"
						:title="$t('dms_database.query.errorTitle')"
						:description="saveError"
					/>
				</div>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton
						variant="outline"
						color="neutral"
						:disabled="saving"
						@click="saveModalOpen = false"
					>
						{{ $t("dms_database.query.saveModal.cancel") }}
					</UButton>
					<UButton
						color="primary"
						:loading="saving"
						:disabled="!saveName.trim() || saving"
						@click="confirmSave"
					>
						{{ $t("dms_database.query.saveModal.save") }}
					</UButton>
				</div>
			</template>
		</UModal>

		<UModal
			v-model:open="mutationModalOpen"
			:title="$t('dms_database.query.mutationModal.title')"
		>
			<template #body>
				<div class="space-y-4">
					<p class="text-sm text-muted">
						{{ $t("dms_database.query.mutationModal.body") }}
					</p>
					<UCheckbox
						v-model="mutationDontRemind"
						:label="$t('dms_database.query.mutationModal.dontRemind')"
					/>
				</div>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton variant="outline" color="neutral" @click="cancelMutation">
						{{ $t("dms_database.query.mutationModal.cancel") }}
					</UButton>
					<UButton color="warning" @click="confirmMutation">
						{{ $t("dms_database.query.mutationModal.confirm") }}
					</UButton>
				</div>
			</template>
		</UModal>
	</div>
</template>

import { h } from "vue";
import type { BrowserTab } from "../../composables/useDataBrowserTabs";
import { cellText } from "./cellValues";
import { type StagedChange, undoBodies, useStagedEdits } from "./stagedEdits";

// Writes the staged edits of a tab after the user reviewed them, then offers
// to take them back for a few seconds. Each row is written with one call of
// the edit route; an undo writes the previous values back the same way.

const EDIT_ENDPOINT = "/api/database/browse/edit";
const UNDO_WINDOW_MS = 10_000;
const NOT_FOUND = 404;

interface StagedSaveOptions {
	tab: () => BrowserTab;
	onSaved: () => void;
	onRowGone: () => void;
}

function statusOf(error: unknown): number | undefined {
	const failure = error as { statusCode?: number; status?: number } | null;
	return failure?.statusCode ?? failure?.status;
}

export function useStagedSave(options: StagedSaveOptions) {
	const { t } = useI18n();
	const { $authFetch } = useAuthFetch();
	const { confirm } = useConfirm();
	const toast = useToast();
	const staged = useStagedEdits();
	const saving = ref(false);

	function scope(tab: BrowserTab): string {
		const instance = tab.instance === DEFAULT_INSTANCE_VALUE ? t("dms_database.data.scope.default") : tab.instance;
		return `${tab.schema}.${tab.table} @${instance}`;
	}

	async function writeRow(tab: BrowserTab, rowId: string, body: Record<string, unknown>) {
		await $authFetch(EDIT_ENDPOINT, {
			method: "PUT",
			query: { ...browseSelectionQuery(tab), id: rowId },
			body,
		});
	}

	function diffTable(changes: StagedChange[]) {
		return h(
			"div",
			{ class: "border-default divide-default max-h-72 divide-y overflow-auto rounded-md border font-mono text-[12px]" },
			changes.map((change) =>
				h("div", { class: "grid grid-cols-[auto_auto_minmax(0,1fr)] gap-4 px-3 py-2 whitespace-nowrap" }, [
					h("span", { class: "text-toned truncate" }, change.rowId),
					h("span", { class: "text-muted truncate" }, change.field),
					h("span", { class: "truncate" }, [
						h("s", { class: "text-dimmed" }, cellText(change.before) || "null"),
						" → ",
						h("span", { class: "text-success" }, cellText(change.after) || "null"),
					]),
				]),
			),
		);
	}

	async function saveAll(tab: BrowserTab, changes: StagedChange[]) {
		const saved: StagedChange[] = [];
		for (const rowId of staged.rowIds(tab.id)) {
			try {
				await writeRow(tab, rowId, staged.rowBody(tab.id, rowId));
			} catch (error) {
				if (statusOf(error) !== NOT_FOUND) throw error;
				// The row was deleted meanwhile: its changes cannot land.
				options.onRowGone();
			}
			saved.push(...changes.filter((change) => change.rowId === rowId));
			staged.discard(tab.id, [rowId]);
		}
		return saved;
	}

	async function undo(tab: BrowserTab, changes: StagedChange[]) {
		try {
			for (const [rowId, body] of undoBodies(changes)) await writeRow(tab, rowId, body);
			toast.add({ title: t("dms_database.data.save.undone", changes.length), color: "neutral", icon: "i-ph-arrow-counter-clockwise" });
		} catch (error) {
			toast.add({
				title: t("dms_database.data.save.undo_failed"),
				description: error instanceof Error ? error.message : undefined,
				color: "error",
			});
		}
		options.onSaved();
	}

	function announce(tab: BrowserTab, saved: StagedChange[]) {
		toast.add({
			title: t("dms_database.data.save.saved", { scope: scope(tab) }, saved.length),
			description: t("dms_database.data.save.saved_description"),
			color: "success",
			icon: "i-ph-check",
			duration: UNDO_WINDOW_MS,
			actions: [
				{
					label: t("dms_database.data.save.undo"),
					icon: "i-ph-arrow-counter-clockwise",
					color: "neutral",
					variant: "outline",
					onClick: () => undo(tab, saved),
				},
			],
		});
	}

	async function review() {
		const tab = options.tab();
		const changes = staged.list(tab.id);
		if (changes.length === 0 || saving.value) return;
		let saved: StagedChange[] = [];
		const confirmed = await confirm({
			title: t("dms_database.data.save.title", { table: tab.table }, changes.length),
			description: t("dms_database.data.save.description", { scope: scope(tab) }),
			confirmLabel: t("dms_database.data.save.confirm", changes.length),
			cancelLabel: t("dms_database.data.save.keep_editing"),
			color: "warning",
			icon: "i-ph-pencil-simple",
			body: () => diffTable(changes),
			onConfirm: async () => {
				saving.value = true;
				try {
					saved = await saveAll(tab, changes);
				} finally {
					saving.value = false;
				}
			},
		});
		if (!confirmed) return;
		options.onSaved();
		if (saved.length > 0) announce(tab, saved);
	}

	return { saving, review };
}

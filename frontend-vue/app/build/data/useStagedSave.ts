import {
	DEFAULT_INSTANCE_VALUE,
	instanceBadge,
} from '../composables/useDataBrowserTabs'
import { browseSelectionQuery } from '../composables/useDataBrowserGrid'
import { h, onScopeDispose } from 'vue'
import type { BrowserTab } from '../composables/useDataBrowserTabs'
import { cellLabel } from './cellValues'
import { type StagedChange, undoBodies, useStagedEdits } from './stagedEdits'
import { changesOf, type RowWriteOutcome, writeRows } from './stagedWrites'

// Writes the staged edits of a tab after the user reviewed them, then offers
// to take them back for a few seconds, in the save bar of the current tab
// (another tab ends the offer). Each row is written with one call of the
// edit route; an undo writes the previous values back the same way. Only the
// rows written are announced and undone: a row gone meanwhile drops its
// changes, and a failure stops the save with the rows left still staged.

const EDIT_ENDPOINT = '/api/database/browse/edit'
const UNDO_WINDOW_MS = 10_000
const UNDONE_NOTICE_MS = 3_000

/** What the save bar says once a save is written, then once it is undone. */
interface SaveNotice {
	state: 'saved' | 'undoing' | 'undone'
	changes: StagedChange[]
	scope: string
}

interface StagedSaveOptions {
	tab: () => BrowserTab
	onSaved: () => void
}

/** The server's reason when it gave one, else the error's own message. */
function messageOf(error: unknown): string {
	const data = (error as { data?: unknown } | null)?.data
	if (typeof data === 'string' && data) return data
	const message = (data as { message?: unknown } | null)?.message
	if (typeof message === 'string' && message) return message
	return error instanceof Error ? error.message : String(error)
}

export function useStagedSave(options: StagedSaveOptions) {
	const { t, n } = useI18n()
	const { $authFetch } = useAuthFetch()
	const { confirm } = useConfirm()
	const toast = useToast()
	const staged = useStagedEdits()
	const saving = ref(false)
	const notice = ref<SaveNotice | null>(null)
	let expiry: ReturnType<typeof setTimeout> | undefined

	/** Shows a notice, for `ms` when given, or ends it with null. */
	function show(next: SaveNotice | null, ms?: number) {
		clearTimeout(expiry)
		notice.value = next
		if (next && ms !== undefined)
			expiry = setTimeout(() => {
				notice.value = null
			}, ms)
	}

	// The notice belongs to the tab it was written on.
	watch(
		() => options.tab().id,
		() => show(null),
	)
	onScopeDispose(() => clearTimeout(expiry))

	// A new edit ends the undo: written under it, the old values would make
	// its review show the wrong "was", and its save would overwrite them.
	watch(
		() => staged.count(options.tab().id),
		(count) => {
			if (count > 0 && notice.value?.state === 'saved') show(null)
		},
	)

	function scope(tab: BrowserTab): string {
		const badge =
			tab.instance === DEFAULT_INSTANCE_VALUE
				? `@${t('dms_database.data.scope.default')}`
				: instanceBadge(tab.instance, t('dms_database.data.scope.all'))
		return `${tab.schema}.${tab.table} ${badge}`
	}

	async function writeRow(
		tab: BrowserTab,
		rowId: string,
		body: Record<string, unknown>,
	) {
		await $authFetch(EDIT_ENDPOINT, {
			method: 'PUT',
			query: { ...browseSelectionQuery(tab), id: rowId },
			body,
		})
	}

	// One change per row: the field and the row on a first line, the value
	// before and after on its own line, wrapped, so neither hides the other.
	function diffTable(changes: StagedChange[]) {
		return h(
			'div',
			{
				class:
					'border-default divide-default max-h-72 divide-y overflow-auto rounded-md border font-mono text-[12px]',
			},
			changes.map((change) => {
				const before = cellLabel(change.before)
				const after = cellLabel(change.after)
				return h('div', { class: 'grid gap-0.5 px-3 py-2' }, [
					h('div', { class: 'flex min-w-0 items-baseline gap-2' }, [
						h('span', { class: 'text-highlighted shrink-0' }, change.field),
						h(
							'span',
							{ class: 'text-dimmed min-w-0 truncate', title: change.rowId },
							change.rowId,
						),
					]),
					h(
						'div',
						{
							class: 'line-clamp-4 break-all',
							title: `${before} → ${after}`,
						},
						[
							h('s', { class: 'text-dimmed' }, before),
							' → ',
							h('span', { class: 'text-success' }, after),
						],
					),
				])
			}),
		)
	}

	// Each row written (or gone) leaves the staged edits at once: a failure
	// further on keeps only the rows not written.
	function saveAll(tab: BrowserTab): Promise<RowWriteOutcome> {
		const rows = staged
			.rowIds(tab.id)
			.map((rowId): [string, Record<string, unknown>] => [
				rowId,
				staged.rowBody(tab.id, rowId),
			])
		return writeRows(
			rows,
			(rowId, body) => writeRow(tab, rowId, body),
			(rowId) => staged.discard(tab.id, [rowId]),
		)
	}

	// What the review dialog says once a save went only part of the way;
	// nothing written at all is an error, shown by the dialog for a retry.
	function partialOutcome(
		outcome: RowWriteOutcome,
		changes: StagedChange[],
		savedCount: number,
	) {
		const nothingSettled =
			outcome.written.length === 0 && outcome.gone.length === 0
		if (outcome.error !== null && nothingSettled) throw outcome.error
		if (outcome.error === null && outcome.gone.length === 0) return undefined
		const details: string[] = []
		if (outcome.gone.length > 0)
			details.push(
				t(
					'dms_database.data.save.rows_gone',
					{ count: n(outcome.gone.length) },
					outcome.gone.length,
				),
			)
		if (outcome.error !== null) {
			const left = changesOf(changes, outcome.left).length
			details.push(
				t(
					'dms_database.data.save.not_written',
					{ count: n(left), error: messageOf(outcome.error) },
					left,
				),
			)
		}
		return {
			partial: {
				title: t(
					'dms_database.data.save.partial_title',
					{ saved: n(savedCount), total: n(changes.length) },
					changes.length,
				),
				description: details.join(' '),
			},
		}
	}

	async function undo() {
		const tab = options.tab()
		const current = notice.value
		if (current?.state !== 'saved') return
		// Kept while the values are written back, however long that takes.
		show({ ...current, state: 'undoing' })
		const outcome = await writeRows(
			undoBodies(current.changes),
			(rowId, body) => writeRow(tab, rowId, body),
		)
		const restored = changesOf(current.changes, outcome.written)
		const gone = changesOf(current.changes, outcome.gone)
		const left = changesOf(current.changes, outcome.left)
		// Another tab since: its bar says nothing of this one, the toasts do.
		const here = options.tab().id === tab.id
		if (left.length > 0) {
			// The rows the failure left keep their undo, for a retry.
			if (here)
				show({ ...current, state: 'saved', changes: left }, UNDO_WINDOW_MS)
			toast.add({
				title: t(
					'dms_database.data.save.undo_partial',
					{ count: n(left.length + gone.length) },
					left.length + gone.length,
				),
				description: messageOf(outcome.error),
				color: 'error',
			})
		} else if (here) {
			show(
				restored.length > 0
					? { ...current, state: 'undone', changes: restored }
					: null,
				UNDONE_NOTICE_MS,
			)
		}
		if (gone.length > 0 && left.length === 0)
			toast.add({
				title: t(
					'dms_database.data.save.undo_partial',
					{ count: n(gone.length) },
					gone.length,
				),
				description: t(
					'dms_database.data.save.rows_missing',
					{ count: n(outcome.gone.length) },
					outcome.gone.length,
				),
				color: 'warning',
			})
		options.onSaved()
	}

	function announce(tab: BrowserTab, saved: StagedChange[]) {
		if (options.tab().id !== tab.id) return
		show({ state: 'saved', changes: saved, scope: scope(tab) }, UNDO_WINDOW_MS)
	}

	async function review() {
		const tab = options.tab()
		const changes = staged.list(tab.id)
		if (changes.length === 0 || saving.value) return
		// Filled as rows land, whatever happens next: a failure, a retry, or
		// the dialog closed, what was written is announced and undoable.
		const saved: StagedChange[] = []
		let settled = false
		try {
			await confirm({
				title: t(
					'dms_database.data.save.title',
					{ table: tab.table },
					changes.length,
				),
				description: t(
					'dms_database.data.save.description',
					{ scope: scope(tab) },
					changes.length,
				),
				confirmLabel: t('dms_database.data.save.confirm', changes.length),
				cancelLabel: t('dms_database.data.save.keep_editing'),
				color: 'warning',
				icon: 'i-ph-pencil-simple',
				body: () => diffTable(changes),
				onConfirm: async () => {
					saving.value = true
					try {
						const outcome = await saveAll(tab)
						saved.push(...changesOf(changes, outcome.written))
						if (outcome.written.length + outcome.gone.length > 0) settled = true
						return partialOutcome(outcome, changes, saved.length)
					} finally {
						saving.value = false
					}
				},
			})
		} finally {
			if (settled) options.onSaved()
			if (saved.length > 0) announce(tab, saved)
		}
	}

	return { saving, review, notice, undo }
}

import {
	DEFAULT_INSTANCE_VALUE,
	instanceBadge,
} from '../composables/useDataBrowserTabs'
import { browseSelectionQuery } from '../composables/useDataBrowserGrid'
import { h, onScopeDispose, shallowRef } from 'vue'
import type { BrowserTab } from '../composables/useDataBrowserTabs'
import { useDatabaseConnections } from '../composables/useDatabaseConnections'
import type { CellRow } from '../utils/values'
import { cellLabel } from './cellValues'
import { type StagedChange, undoBodies, useStagedEdits } from './stagedEdits'
import { changesOf, type RowWriteOutcome, writeRows } from './stagedWrites'

const EDIT_ENDPOINT = '/api/database/browse/edit'
const UNDO_WINDOW_MS = 10_000
const UNDONE_NOTICE_MS = 3_000

type RowQuery = ReturnType<typeof browseSelectionQuery> & {
	id: string
	connection?: string
}

/** What the save bar says once a save is written, then once it is undone. */
export interface SaveNotice {
	state: 'saved' | 'undoing' | 'undone'
	changes: StagedChange[]
	scope: string
}

/** What a save or an undo wrote, once it is settled. */
export interface SavedChanges {
	/** The fields written. */
	fields: string[]
	/** Rows gone meanwhile, which the page may still show. */
	gone: number
}

interface StagedSaveOptions {
	tab: () => BrowserTab
	/** A row written, as the server answered: shown at once in place of the one read. */
	onWritten: (tab: BrowserTab, row: CellRow) => void
	onSaved: (saved: SavedChanges) => void
}

type StagedEdits = ReturnType<typeof useStagedEdits>

function fieldsOf(changes: StagedChange[]): string[] {
	return [...new Set(changes.map((change) => change.field))]
}

/** One change per row: the field and the row on a first line, the value before and after on its own line, wrapped, so neither hides the other. */
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

/**
 * The save bar's notice. It belongs to the tab it was written on, and a new
 * edit ends the undo: written under it, the old values would make its review
 * show the wrong "was", and its save would overwrite them. `show` puts a
 * notice up, for `ms` when given, or ends it with null.
 */
function useSaveNotice(tab: () => BrowserTab, staged: StagedEdits) {
	const notice = shallowRef<SaveNotice | null>(null)
	let expiry: ReturnType<typeof setTimeout> | undefined

	function show(next: SaveNotice | null, ms?: number) {
		clearTimeout(expiry)
		notice.value = next
		if (next && ms !== undefined)
			expiry = setTimeout(() => {
				notice.value = null
			}, ms)
	}

	watch(
		() => tab().id,
		() => show(null),
	)
	onScopeDispose(() => clearTimeout(expiry))
	watch(
		() => staged.count(tab().id),
		(count) => {
			if (count > 0 && notice.value?.state === 'saved') show(null)
		},
	)
	return { notice, show }
}

/**
 * The row calls of a save and of its undo, each row shown as the server
 * answered it. A row written (or gone) leaves the staged edits at once, its
 * answer shown in its place: a failure further on keeps only the rows not
 * written.
 */
function useRowWriter(options: StagedSaveOptions, staged: StagedEdits) {
	const { $authFetch } = useAuthFetch()
	const { selected } = useDatabaseConnections()

	function writeRow(
		tab: BrowserTab,
		rowId: string,
		body: CellRow,
	): Promise<CellRow> {
		const query: RowQuery = { ...browseSelectionQuery(tab), id: rowId }
		if (selected.value) query.connection = selected.value.id
		return $authFetch<CellRow>(EDIT_ENDPOINT, { method: 'PUT', query, body })
	}

	function showWritten(tab: BrowserTab, row: CellRow | undefined) {
		if (row) options.onWritten(tab, row)
	}

	function saveAll(tab: BrowserTab): Promise<RowWriteOutcome> {
		const rows = staged
			.rowIds(tab.id)
			.map((rowId): [string, CellRow] => [rowId, staged.rowBody(tab.id, rowId)])
		return writeRows(
			rows,
			(rowId, body) => writeRow(tab, rowId, body),
			(rowId, row) => {
				showWritten(tab, row)
				staged.discard(tab.id, [rowId])
			},
		)
	}

	function undoAll(
		tab: BrowserTab,
		changes: StagedChange[],
	): Promise<RowWriteOutcome> {
		return writeRows(
			undoBodies(changes),
			(rowId, body) => writeRow(tab, rowId, body),
			(_rowId, row) => showWritten(tab, row),
		)
	}

	return { saveAll, undoAll }
}

/**
 * The save's wording: its scope, and what the review dialog says once a save
 * went only part of the way. Nothing written at all is an error, shown by the
 * dialog for a retry.
 */
function useSaveMessages() {
	const { t, n } = useI18n()
	const presenter = useApiErrorPresenter()

	function scope(tab: BrowserTab): string {
		const badge =
			tab.instance === DEFAULT_INSTANCE_VALUE
				? `@${t('dms_database.data.scope.default')}`
				: instanceBadge(tab.instance, t('dms_database.data.scope.all'))
		return `${tab.schema}.${tab.table} ${badge}`
	}

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
			const notice = presenter.resolveError(outcome.error, {
				fallbackKey: 'error.500.description',
			})
			details.push(
				t(
					'dms_database.data.save.not_written',
					{ count: n(left), error: notice?.message ?? '' },
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

	return { scope, partialOutcome }
}

/**
 * Writes the staged edits of a tab after the user reviewed them, then offers
 * to take them back for a few seconds, in the save bar of the current tab
 * (another tab ends the offer). Each row is written with one call of the
 * edit route, which answers with the row as stored; an undo writes the
 * previous values back the same way. Only the rows written are announced and
 * undone: a row gone meanwhile drops its changes, and a failure stops the
 * save with the rows left still staged.
 */
export function useStagedSave(options: StagedSaveOptions) {
	const { t, n } = useI18n()
	const { confirm } = useConfirm()
	const toast = useToast()
	const presenter = useApiErrorPresenter()
	const staged = useStagedEdits()
	const saving = ref(false)
	const { notice, show } = useSaveNotice(options.tab, staged)
	const { saveAll, undoAll } = useRowWriter(options, staged)
	const { scope, partialOutcome } = useSaveMessages()

	async function undo() {
		const tab = options.tab()
		const current = notice.value
		if (current?.state !== 'saved') return
		show({ ...current, state: 'undoing' })
		const outcome = await undoAll(tab, current.changes)
		const restored = changesOf(current.changes, outcome.written)
		const gone = changesOf(current.changes, outcome.gone)
		const left = changesOf(current.changes, outcome.left)
		const here = options.tab().id === tab.id
		if (left.length > 0) {
			if (here)
				show({ ...current, state: 'saved', changes: left }, UNDO_WINDOW_MS)
			const wholly = restored.length === 0 && gone.length === 0
			presenter.presentError(outcome.error, {
				fallbackKey: wholly
					? 'dms_database.data.save.undo_failed'
					: 'dms_database.data.save.undo_partial',
				params: { count: left.length + gone.length },
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
		options.onSaved({
			fields: fieldsOf(current.changes),
			gone: outcome.gone.length,
		})
	}

	function announce(tab: BrowserTab, saved: StagedChange[]) {
		if (options.tab().id !== tab.id) return
		show({ state: 'saved', changes: saved, scope: scope(tab) }, UNDO_WINDOW_MS)
	}

	async function review() {
		const tab = options.tab()
		const changes = staged.list(tab.id)
		if (changes.length === 0 || saving.value) return
		const saved: StagedChange[] = []
		let settled = false
		let gone = 0
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
						gone += outcome.gone.length
						if (outcome.written.length + outcome.gone.length > 0) settled = true
						return partialOutcome(outcome, changes, saved.length)
					} finally {
						saving.value = false
					}
				},
			})
		} finally {
			if (settled) options.onSaved({ fields: fieldsOf(saved), gone })
			if (saved.length > 0) announce(tab, saved)
		}
	}

	return { saving, review, notice, undo }
}

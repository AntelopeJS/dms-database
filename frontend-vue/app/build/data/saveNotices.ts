import type { StagedChange } from './stagedEdits'

// What the data browser's save bar says once a save is written: the save and
// its undo for a few seconds, then the undo's result. One per tab, so it
// survives switching tabs as the staged edits do.

export const UNDO_WINDOW_MS = 10_000
export const UNDONE_NOTICE_MS = 3_000

export interface SaveNotice {
	state: 'saved' | 'undoing' | 'undone'
	changes: StagedChange[]
	scope: string
	/** When the bar stops showing it, in ms since the epoch. */
	until: number
}

/** The notice of a tab, while it lasts. */
export function liveNotice(
	notices: Record<string, SaveNotice>,
	tabId: string,
	now: number,
): SaveNotice | null {
	const notice = notices[tabId]
	return notice && notice.until > now ? notice : null
}

export function useSaveNotices() {
	const notices = useDmsState<Record<string, SaveNotice>>(
		'dms-database-save-notices',
		() => ({}),
	)

	/** Sets (or, with null, ends) the notice of a tab; spent ones go. */
	function set(tabId: string, notice: SaveNotice | null) {
		const now = Date.now()
		const next = Object.fromEntries(
			Object.entries(notices.value).filter(
				([id, kept]) => id !== tabId && kept.until > now,
			),
		)
		if (notice) next[tabId] = notice
		notices.value = next
	}

	return { notices, set }
}

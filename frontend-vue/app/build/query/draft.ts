// The query being written, kept for the browser tab: a reload, or a row link
// followed by Back, brings it back. A link that names a query wins over it.

export const DRAFT_KEY = 'dms-database:query:draft'

export interface QueryDraft {
	source: string
	/** The saved query the editor opened, if any. */
	savedId?: string | null
}

interface DraftStorage {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
	removeItem(key: string): void
}

function storage(): DraftStorage | null {
	try {
		return typeof window === 'undefined' ? null : window.sessionStorage
	} catch {
		return null
	}
}

export function readDraft(store = storage()): QueryDraft | null {
	try {
		const raw = store?.getItem(DRAFT_KEY)
		if (!raw) return null
		const draft = JSON.parse(raw) as Partial<QueryDraft> | null
		if (typeof draft?.source !== 'string') return null
		return {
			source: draft.source,
			savedId: typeof draft.savedId === 'string' ? draft.savedId : null,
		}
	} catch {
		return null
	}
}

export function writeDraft(draft: QueryDraft, store = storage()): void {
	try {
		if (!draft.source.trim() && !draft.savedId) store?.removeItem(DRAFT_KEY)
		else store?.setItem(DRAFT_KEY, JSON.stringify(draft))
	} catch {
		// A full or blocked storage only loses the draft.
	}
}

// How a typed draft becomes a cell value: the stored type is kept, and a
// column whose cell is empty falls back to the type sampled for it, so filling
// an empty cell of a number column stores a number. A date column takes a
// date whatever its cell holds, as dates travel as ISO text.
//
// "null" empties a cell, whatever its type. The text "null" itself is typed
// escaped, "\null" (and "\\null" for "\null"): an editor opens a cell holding
// such a text escaped, so committing it unchanged keeps it.

type DraftResult =
	| { ok: true; value: unknown; unchanged: boolean }
	| { ok: false; reason: 'number' | 'boolean' | 'date' }

type Parser = (text: string) => DraftResult

const BOOLEANS: Record<string, boolean> = { true: true, false: false }
const NULL_DRAFT = 'null'
// A text made of backslashes then "null": typed with one more backslash.
const NULL_LIKE_TEXT = /^\\*null$/
const ESCAPED_NULL = /^\\+null$/
// YYYY-MM-DD, then optionally a time (T or a space) and a zone.
const DATE_DRAFT =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i

function parsed(value: unknown): DraftResult {
	return { ok: true, value, unchanged: false }
}

// Date.parse rolls an impossible day over (2026-02-30 is March 2nd): the
// calendar date typed must exist.
function isCalendarDate(year: number, month: number, day: number): boolean {
	const date = new Date(Date.UTC(year, month - 1, day))
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	)
}

function parseDate(text: string): DraftResult {
	const trimmed = text.trim()
	const match = DATE_DRAFT.exec(trimmed)
	const time = match ? Date.parse(trimmed) : Number.NaN
	if (
		!match ||
		Number.isNaN(time) ||
		!isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
	)
		return { ok: false, reason: 'date' }
	return parsed(new Date(time).toISOString())
}

const PARSERS: Record<string, Parser> = {
	number: (text) => {
		const trimmed = text.trim()
		const value = Number(trimmed)
		return trimmed === '' || !Number.isFinite(value)
			? { ok: false, reason: 'number' }
			: parsed(value)
	},
	boolean: (text) => {
		const value = BOOLEANS[text.trim().toLowerCase()]
		return value === undefined
			? { ok: false, reason: 'boolean' }
			: parsed(value)
	},
	date: parseDate,
}

function isEmpty(value: unknown): boolean {
	return value === null || value === undefined
}

/** The value a draft stands for, given the cell's current value and column type. */
export function parseDraft(
	draft: string | boolean,
	before: unknown,
	columnType: string,
): DraftResult {
	if (typeof draft === 'boolean')
		return { ok: true, value: draft, unchanged: draft === before }
	if (draft.trim() === NULL_DRAFT)
		return { ok: true, value: null, unchanged: isEmpty(before) }
	// Leaving an empty cell empty is not an edit.
	if (isEmpty(before) && draft === '')
		return { ok: true, value: before, unchanged: true }
	const text = ESCAPED_NULL.test(draft) ? draft.slice(1) : draft
	const type =
		columnType === 'date'
			? 'date'
			: isEmpty(before)
				? columnType
				: typeof before
	const result = (PARSERS[type] ?? parsed)(text)
	if (!result.ok) return result
	return {
		...result,
		unchanged: !isEmpty(before) && String(before) === String(result.value),
	}
}

/** The text an editor opens a cell with: see the escape above. */
export function draftText(value: unknown): string {
	if (typeof value === 'string' && NULL_LIKE_TEXT.test(value))
		return `\\${value}`
	return cellText(value)
}

/** A cell as one line of text: JSON for objects and lists. */
export function cellText(value: unknown): string {
	if (isEmpty(value)) return ''
	if (typeof value !== 'object') return String(value)
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

/**
 * A cell as the review and the "was" hints name it: an empty cell reads
 * null, and a text that would read as one of those is quoted ("", "null").
 */
export function cellLabel(value: unknown): string {
	if (isEmpty(value)) return NULL_DRAFT
	if (value === '' || value === NULL_DRAFT) return JSON.stringify(value)
	return cellText(value)
}

export function isStructured(value: unknown): boolean {
	return value !== null && typeof value === 'object'
}

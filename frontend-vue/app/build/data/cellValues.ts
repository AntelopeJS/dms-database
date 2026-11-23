import {
	type CellValue,
	isBoolean,
	isCellValue,
	isNumber,
	isText,
} from '../utils/values'

/** A cell value that is not structured. */
type CellScalar = string | number | boolean | null | undefined

type DraftResult =
	| { ok: true; value: CellScalar; unchanged: boolean }
	| { ok: false; reason: 'number' | 'boolean' | 'date' }

type Parser = (text: string) => DraftResult

const BOOLEANS = new Map([
	['true', true],
	['false', false],
])
const NULL_DRAFT = 'null'

/** A text made of backslashes then "null": typed with one more backslash. */
const NULL_LIKE_TEXT = /^\\*null$/
const ESCAPED_NULL = /^\\+null$/

/** YYYY-MM-DD, then optionally a time (T or a space) and a zone. */
const DATE_DRAFT =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i

function parsed(value: CellScalar): DraftResult {
	return { ok: true, value, unchanged: false }
}

/** Date.parse rolls an impossible day over (2026-02-30 is March 2nd): the calendar date typed must exist. */
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

const PARSERS = new Map<string, Parser>([
	[
		'number',
		(text) => {
			const trimmed = text.trim()
			const value = Number(trimmed)
			return trimmed === '' || !Number.isFinite(value)
				? { ok: false, reason: 'number' }
				: parsed(value)
		},
	],
	[
		'boolean',
		(text) => {
			const value = BOOLEANS.get(text.trim().toLowerCase())
			return value === undefined
				? { ok: false, reason: 'boolean' }
				: parsed(value)
		},
	],
	['date', parseDate],
])

function isEmpty(value: CellValue): value is null | undefined {
	return value === null || value === undefined
}

/** Whether a value holds other values: an object or a list. */
export function isStructured(
	value: CellValue,
): value is CellValue[] | { [key: string]: CellValue } {
	return typeof value === 'object' && value !== null
}

function sampledType(value: CellValue): string {
	if (isNumber(value)) return 'number'
	if (isBoolean(value)) return 'boolean'
	return 'other'
}

/**
 * The value a draft stands for, given the cell's current value and column
 * type. The stored type is kept, and a column whose cell is empty falls back
 * to the type sampled for it, so filling an empty cell of a number column
 * stores a number. A date column takes a date whatever its cell holds, as
 * dates travel as ISO text. Leaving an empty cell empty is not an edit.
 *
 * "null" empties a cell, whatever its type. The text "null" itself is typed
 * escaped, "\null" (and "\\null" for "\null"): an editor opens a cell holding
 * such a text escaped, so committing it unchanged keeps it.
 */
export function parseDraft(
	draft: string | boolean,
	before: CellValue,
	columnType: string,
): DraftResult {
	if (draft === true || draft === false)
		return { ok: true, value: draft, unchanged: draft === before }
	if (draft.trim() === NULL_DRAFT)
		return { ok: true, value: null, unchanged: isEmpty(before) }
	if (isEmpty(before) && draft === '')
		return { ok: true, value: before, unchanged: true }
	const text = ESCAPED_NULL.test(draft) ? draft.slice(1) : draft
	const type =
		columnType === 'date'
			? 'date'
			: isEmpty(before)
				? columnType
				: sampledType(before)
	const result = (PARSERS.get(type) ?? parsed)(text)
	if (!result.ok) return result
	return {
		...result,
		unchanged:
			!isEmpty(before) &&
			!isStructured(before) &&
			String(before) === String(result.value),
	}
}

/** The text an editor opens a cell with: see the escape of `parseDraft`. */
export function draftText(value: CellValue): string {
	if (isText(value) && NULL_LIKE_TEXT.test(value)) return `\\${value}`
	return cellText(value)
}

/** A cell as one line of text: JSON for objects and lists. */
export function cellText(value: CellValue): string {
	if (isEmpty(value)) return ''
	if (!isStructured(value)) return String(value)
	try {
		return JSON.stringify(value)
	} catch {
		return Object.prototype.toString.call(value)
	}
}

/**
 * A cell as the review and the "was" hints name it: an empty cell reads
 * null, and a text that would read as one of those is quoted ("", "null").
 */
export function cellLabel(value: CellValue): string {
	if (isEmpty(value)) return NULL_DRAFT
	if (value === '' || value === NULL_DRAFT) return JSON.stringify(value)
	return cellText(value)
}

/** Past this length a text no longer reads whole in the drawer's value column. */
const WIDE_TEXT_LENGTH = 48

/**
 * Whether a row drawer gives the value the drawer's width, its label above:
 * an object or a list (edited as JSON), and a text of several lines or too
 * long for the value column (edited in a text area).
 */
export function isWideValue(value: CellValue): boolean {
	if (isStructured(value)) return true
	return (
		isText(value) && (value.length > WIDE_TEXT_LENGTH || value.includes('\n'))
	)
}

type JsonDraftResult =
	| { ok: true; value: CellValue }
	| { ok: false; reason: 'invalid' | 'not_structured'; detail?: string }

/** The text the JSON editor opens a structured cell with. */
export function jsonDraftText(value: unknown): string {
	if (isCellValue(value)) {
		try {
			return JSON.stringify(value, null, 2) ?? ''
		} catch {
			return ''
		}
	}
	return ''
}

/**
 * The value a JSON editor's draft stands for: an object, a list, or null to
 * empty the cell. A scalar is not a structured cell. An invalid draft carries
 * the engine's parse detail (position, token…).
 */
export function parseJsonDraft(text: string): JsonDraftResult {
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch (error) {
		return {
			ok: false,
			reason: 'invalid',
			detail: error instanceof Error ? error.message : undefined,
		}
	}
	if (!isCellValue(value)) return { ok: false, reason: 'invalid' }
	if (value !== null && !isStructured(value))
		return { ok: false, reason: 'not_structured' }
	return { ok: true, value }
}

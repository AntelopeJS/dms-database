import { describe, expect, it } from 'vitest'
import {
	CROSS_INSTANCE_VALUE,
	DEFAULT_INSTANCE_VALUE,
	instanceBadge,
	instanceChoiceOf,
	tabInstanceOf,
} from '../app/build/composables/useDataBrowserTabs'
import {
	cellLabel,
	draftText,
	isWideValue,
	jsonDraftText,
	parseDraft,
	parseJsonDraft,
} from '../app/build/data/cellValues'
import {
	changesOf,
	mayMoveRows,
	withWrittenRow,
	writeRows,
} from '../app/build/data/stagedWrites'
import {
	instanceFromUrl,
	instanceToUrl,
	tableLink,
} from '../app/build/utils/databaseLinks'
import { fillingLines } from '../app/build/utils/fillingLines'
import {
	ROW_HEADER_COMPONENT,
	rowHeaderOptions,
} from '../app/build/data/rowDrawerHeader'
import { describeField, valueDescriptor } from '../app/build/utils/fieldTypes'

describe('cell drafts: null', () => {
	it('empties a cell of any type with null', () => {
		expect(parseDraft('null', 'Ada', 'string')).toEqual({
			ok: true,
			value: null,
			unchanged: false,
		})
		expect(parseDraft(' null ', 42, 'number')).toMatchObject({
			ok: true,
			value: null,
		})
		expect(
			parseDraft('null', '2026-10-01T10:00:00.000Z', 'date'),
		).toMatchObject({ ok: true, value: null })
		expect(parseDraft('null', null, 'string')).toMatchObject({
			unchanged: true,
		})
	})

	it('types the text null escaped, one backslash more', () => {
		expect(parseDraft('\\null', null, 'string')).toMatchObject({
			ok: true,
			value: 'null',
		})
		expect(parseDraft('\\\\null', 'x', 'string')).toMatchObject({
			value: '\\null',
		})
		expect(draftText('null')).toBe('\\null')
		expect(draftText('\\null')).toBe('\\\\null')
		expect(draftText('nullable')).toBe('nullable')
		// Opened then committed as it is, the text stays.
		expect(parseDraft(draftText('null'), 'null', 'string')).toMatchObject({
			value: 'null',
			unchanged: true,
		})
		expect(parseDraft('\\null', 1, 'number')).toEqual({
			ok: false,
			reason: 'number',
		})
	})

	it('tells an empty text from an empty cell', () => {
		expect(parseDraft('', 'Ada', 'string')).toMatchObject({
			ok: true,
			value: '',
			unchanged: false,
		})
		expect(cellLabel('')).toBe('""')
		expect(cellLabel(null)).toBe('null')
		expect(cellLabel(undefined)).toBe('null')
		expect(cellLabel('null')).toBe('"null"')
		expect(cellLabel('nullable')).toBe('nullable')
		expect(cellLabel({ a: 1 })).toBe('{"a":1}')
	})
})

describe('cell drafts: dates', () => {
	const stored = '2026-10-01T10:00:00.000Z'

	it('refuses what is not a date', () => {
		for (const draft of ['not a date', '42', '', '2026-13-01', '2026-02-30'])
			expect(parseDraft(draft, stored, 'date')).toEqual({
				ok: false,
				reason: 'date',
			})
	})

	it('stores a date as ISO text, and an echo as unchanged', () => {
		expect(parseDraft('2026-10-05', stored, 'date')).toEqual({
			ok: true,
			value: '2026-10-05T00:00:00.000Z',
			unchanged: false,
		})
		expect(parseDraft('2026-10-05T08:30:00Z', null, 'date')).toMatchObject({
			value: '2026-10-05T08:30:00.000Z',
		})
		expect(parseDraft(stored, stored, 'date')).toMatchObject({
			unchanged: true,
		})
	})
})

describe('cell drafts: JSON', () => {
	it('opens a structured cell as indented JSON', () => {
		expect(jsonDraftText({ a: [1, 2] })).toBe(
			JSON.stringify({ a: [1, 2] }, null, 2),
		)
		expect(jsonDraftText({ a: 1 }).split('\n')).toHaveLength(3)
		const cyclic: Record<string, unknown> = {}
		cyclic.self = cyclic
		expect(jsonDraftText(cyclic)).toBe('')
	})

	it('takes an object, a list, or null to empty the cell', () => {
		expect(parseJsonDraft('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
		expect(parseJsonDraft('[1]')).toEqual({ ok: true, value: [1] })
		expect(parseJsonDraft(' null ')).toEqual({ ok: true, value: null })
	})

	it('refuses a scalar, and invalid JSON with its parse detail', () => {
		for (const draft of ['42', '"text"', 'true'])
			expect(parseJsonDraft(draft)).toEqual({
				ok: false,
				reason: 'not_structured',
			})
		const invalid = parseJsonDraft('{"a":')
		expect(invalid).toMatchObject({ ok: false, reason: 'invalid' })
		expect(invalid.ok || invalid.detail).toBeTruthy()
	})
})

describe('JSON cell editor: filling the drawer', () => {
	// 12 lines of 19px in a 40px frame; label, legend and footer take 160px.
	const measure = {
		room: 800,
		used: 160,
		editor: 12 * 19 + 40,
		lines: 12,
		lineHeight: 19,
		minLines: 12,
	}

	it('shows as many lines as the room left to the editor holds', () => {
		// 800 - 160 - 40 = 600px of lines.
		expect(fillingLines(measure)).toBe(31)
		// The same answer once grown: its frame is what it measures beyond.
		expect(fillingLines({ ...measure, lines: 31, editor: 31 * 19 + 40 })).toBe(
			31,
		)
	})

	it('follows the room: a wider or taller drawer, an error shown', () => {
		expect(fillingLines({ ...measure, room: 1000 })).toBe(42)
		expect(fillingLines({ ...measure, used: 200 })).toBe(29)
	})

	it('does not grow on code shorter than its lines', () => {
		// 4 lines shown of 31 asked: the same lines, measure after measure.
		const short = { ...measure, editor: 4 * 19 + 40 }
		expect(fillingLines({ ...short, lines: 31 })).toBe(33)
		expect(fillingLines({ ...short, lines: 33 })).toBe(33)
	})

	it('never shows fewer than its minimum, on a short screen', () => {
		expect(fillingLines({ ...measure, room: 300 })).toBe(12)
		expect(fillingLines({ ...measure, room: 0 })).toBe(12)
	})
})

describe('staged writes', () => {
	const rows: [string, Record<string, unknown>][] = [
		['a', { name: 'A' }],
		['b', { name: 'B' }],
		['c', { name: 'C' }],
	]

	it('writes every row and settles each', async () => {
		const settled: string[] = []
		const outcome = await writeRows(
			rows,
			async () => undefined,
			(id) => settled.push(id),
		)
		expect(outcome).toEqual({
			written: ['a', 'b', 'c'],
			gone: [],
			error: null,
			left: [],
		})
		expect(settled).toEqual(['a', 'b', 'c'])
	})

	it('counts a row gone meanwhile apart, and goes on', async () => {
		const outcome = await writeRows(rows, async (id) => {
			if (id === 'b')
				throw Object.assign(new Error('gone'), { statusCode: 404 })
		})
		expect(outcome.written).toEqual(['a', 'c'])
		expect(outcome.gone).toEqual(['b'])
		expect(outcome.error).toBeNull()
	})

	it('stops at another failure, leaving the rows after it unsettled', async () => {
		const failure = Object.assign(new Error('boom'), { statusCode: 500 })
		const settled: string[] = []
		const outcome = await writeRows(
			rows,
			async (id) => {
				if (id === 'b') throw failure
			},
			(id) => settled.push(id),
		)
		expect(outcome).toEqual({
			written: ['a'],
			gone: [],
			error: failure,
			left: ['b', 'c'],
		})
		expect(settled).toEqual(['a'])
	})

	it('hands each row written its answer, and a row gone none', async () => {
		const settled: [string, unknown][] = []
		await writeRows(
			rows,
			async (id, body) => {
				if (id === 'b')
					throw Object.assign(new Error('gone'), { statusCode: 404 })
				return { _id: id, ...body, stored: true }
			},
			(id, answer) => settled.push([id, answer]),
		)
		expect(settled).toEqual([
			['a', { _id: 'a', name: 'A', stored: true }],
			['b', undefined],
			['c', { _id: 'c', name: 'C', stored: true }],
		])
	})

	it('picks the changes of the rows written', () => {
		const changes = [
			{ rowId: 'a', field: 'x' },
			{ rowId: 'b', field: 'x' },
			{ rowId: 'a', field: 'y' },
		]
		expect(changesOf(changes, ['a'])).toEqual([
			{ rowId: 'a', field: 'x' },
			{ rowId: 'a', field: 'y' },
		])
	})
})

describe('rows written in place', () => {
	const idOf = (row: Record<string, unknown>) =>
		row._id === undefined ? null : String(row._id)
	const page = [
		{ _id: 1, name: 'Ada', _instance: 'eu' },
		{ _id: 2, name: 'Bob', _instance: 'eu' },
	]

	it('shows the row the server answered in place of the one read', () => {
		expect(
			withWrittenRow(page, { _id: 2, name: 'Bea', updated: true }, idOf),
		).toEqual([
			{ _id: 1, name: 'Ada', _instance: 'eu' },
			{ _id: 2, name: 'Bea', updated: true, _instance: 'eu' },
		])
		expect(withWrittenRow(page, { _id: 3, name: 'Cy' }, idOf)).toEqual(page)
		expect(withWrittenRow(page, { name: 'no id' }, idOf)).toBe(page)
	})

	it('reads the page again only when a write may move rows in or out of it', () => {
		const plain = { sortKey: null, search: '', filtered: [] }
		expect(mayMoveRows(['name'], plain)).toBe(false)
		expect(mayMoveRows(['name'], { ...plain, sortKey: 'total' })).toBe(false)
		expect(mayMoveRows(['name'], { ...plain, sortKey: 'name' })).toBe(true)
		expect(mayMoveRows(['name'], { ...plain, filtered: ['status'] })).toBe(
			false,
		)
		expect(
			mayMoveRows(['name', 'status'], { ...plain, filtered: ['status'] }),
		).toBe(true)
		expect(mayMoveRows(['name'], { ...plain, search: 'ad' })).toBe(true)
		expect(mayMoveRows([], plain)).toBe(false)
	})
})

describe('instance URL parameter', () => {
	it('reads none as the default instance, all as every instance', () => {
		expect(instanceFromUrl(undefined)).toEqual({ kind: 'default' })
		expect(instanceFromUrl('')).toEqual({ kind: 'default' })
		expect(instanceFromUrl('all')).toEqual({ kind: 'all' })
		expect(instanceFromUrl('eu')).toEqual({ kind: 'named', id: 'eu' })
		expect(instanceFromUrl(['eu', 'us'])).toEqual({ kind: 'named', id: 'eu' })
		// No escaping, and the 0.0.14 cross-instance value is a name now.
		expect(instanceFromUrl('~all')).toEqual({ kind: 'named', id: '~all' })
		expect(instanceFromUrl('__CROSS_INSTANCE__')).toEqual({
			kind: 'named',
			id: '__CROSS_INSTANCE__',
		})
	})

	it('writes the default instance as none, every instance as all', () => {
		expect(instanceToUrl({ kind: 'default' })).toBeUndefined()
		expect(instanceToUrl({ kind: 'all' })).toBe('all')
		expect(instanceToUrl({ kind: 'named', id: 'eu' })).toBe('eu')
		expect(
			tableLink('data', { schema: 's', table: 't', instance: 'all' }),
		).toBe('/modules/database/data?schema=s&table=t&instance=all')
	})

	it('maps a tab instance to the URL and back', () => {
		expect(instanceToUrl(instanceChoiceOf(DEFAULT_INSTANCE_VALUE))).toBe(
			undefined,
		)
		expect(instanceToUrl(instanceChoiceOf(CROSS_INSTANCE_VALUE))).toBe('all')
		for (const instance of [DEFAULT_INSTANCE_VALUE, CROSS_INSTANCE_VALUE, 'eu'])
			expect(
				tabInstanceOf(
					instanceFromUrl(instanceToUrl(instanceChoiceOf(instance))),
				),
			).toBe(instance)
	})

	it('names the instance of a tab', () => {
		expect(instanceBadge(DEFAULT_INSTANCE_VALUE, 'all')).toBeNull()
		expect(instanceBadge(CROSS_INSTANCE_VALUE, 'toutes')).toBe('@toutes')
		expect(instanceBadge('eu', 'all')).toBe('@eu')
	})
})

describe('row drawer', () => {
	it('gives JSON and long or multi-line text the drawer width', () => {
		expect(isWideValue({ city: 'Liège' })).toBe(true)
		expect(isWideValue([1, 2])).toBe(true)
		expect(isWideValue('x'.repeat(49))).toBe(true)
		expect(isWideValue('line one\nline two')).toBe(true)
		expect(isWideValue('x'.repeat(48))).toBe(false)
		expect(isWideValue('open')).toBe(false)
		expect(isWideValue(true)).toBe(false)
		expect(isWideValue(null)).toBe(false)
		expect(isWideValue(42)).toBe(false)
	})

	it('heads the drawer with the DMS row header, "Row N of M" and the steps', () => {
		const navigation = {
			index: 2,
			total: 50,
			hasPrev: true,
			hasNext: true,
			prev: () => undefined,
			next: () => undefined,
		}
		expect(ROW_HEADER_COMPONENT).toBe('DmsRowHeader')
		expect(rowHeaderOptions('ticket-182', navigation)).toEqual({
			part: 'dms-row-drawer',
			heading: 'ticket-182',
			positionLabel: '$dms_database.data.row.position',
			navigation,
			headingClass: expect.stringContaining('text-[17px]'),
		})
	})
})

describe('column types', () => {
	it('reads a nullable union as the type it holds, with its icon', () => {
		const nullable = {
			kind: 'union' as const,
			members: [{ kind: 'string' as const }, { kind: 'null' as const }],
		}
		expect(describeField(valueDescriptor(nullable))).toEqual({
			icon: 'i-ph-text-aa',
			label: 'string',
		})
		const several = {
			kind: 'union' as const,
			members: [
				{ kind: 'string' as const },
				{ kind: 'number' as const },
				{ kind: 'undefined' as const },
			],
		}
		expect(describeField(valueDescriptor(several)).label).toBe(
			'string | number',
		)
		// Only null: nothing else to read it as.
		const onlyNull = {
			kind: 'union' as const,
			members: [{ kind: 'null' as const }],
		}
		expect(valueDescriptor(onlyNull)).toBe(onlyNull)
	})

	it('draws a union with an icon of the Phosphor set', () => {
		expect(
			describeField({
				kind: 'union',
				members: [{ kind: 'string' }, { kind: 'number' }],
			}).icon,
		).toBe('i-ph-arrows-split')
	})
})

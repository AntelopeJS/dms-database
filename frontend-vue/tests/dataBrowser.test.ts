import { describe, expect, it } from 'vitest'
import {
	CROSS_INSTANCE_VALUE,
	DEFAULT_INSTANCE_VALUE,
	instanceBadge,
	instanceFromParam,
	instanceToParam,
	settleUrlWrite,
} from '../app/build/composables/useDataBrowserTabs'
import { cellLabel, draftText, parseDraft } from '../app/build/data/cellValues'
import { changesOf, writeRows } from '../app/build/data/stagedWrites'
import {
	decodeNamedInstance,
	encodeNamedInstance,
	tableLink,
} from '../app/build/utils/databaseLinks'

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

describe('data browser URL: instances', () => {
	it('writes every instance as all, and reads it back', () => {
		expect(instanceToParam(DEFAULT_INSTANCE_VALUE)).toBeUndefined()
		expect(instanceToParam(CROSS_INSTANCE_VALUE)).toBe('all')
		expect(instanceToParam('eu')).toBe('eu')
		expect(instanceFromParam(undefined)).toBe(DEFAULT_INSTANCE_VALUE)
		expect(instanceFromParam('')).toBe(DEFAULT_INSTANCE_VALUE)
		expect(instanceFromParam('all')).toBe(CROSS_INSTANCE_VALUE)
		expect(instanceFromParam('eu')).toBe('eu')
		// Links written before still open the cross-instance view.
		expect(instanceFromParam(CROSS_INSTANCE_VALUE)).toBe(CROSS_INSTANCE_VALUE)
	})

	it('escapes an instance really named all', () => {
		expect(instanceToParam('all')).toBe('~all')
		expect(instanceFromParam('~all')).toBe('all')
		expect(encodeNamedInstance('~eu')).toBe('~~eu')
		expect(decodeNamedInstance('~~eu')).toBe('~eu')
		for (const id of ['all', '~all', '~', 'eu', 'tenant-1'])
			expect(instanceFromParam(instanceToParam(id))).toBe(id)
		expect(
			tableLink('data', { schema: 's', table: 't', instance: 'all' }),
		).toBe('/modules/database/data?schema=s&table=t&instance=%7Eall')
	})

	it('names the instance of a tab', () => {
		expect(instanceBadge(DEFAULT_INSTANCE_VALUE, 'all')).toBeNull()
		expect(instanceBadge(CROSS_INSTANCE_VALUE, 'toutes')).toBe('@toutes')
		expect(instanceBadge('eu', 'all')).toBe('@eu')
	})
})

describe('data browser URL writes: settled visits', () => {
	it('keeps a write the route reached, for its watcher', () => {
		const writes = ['shop::eu::orders']
		settleUrlWrite(writes, 'shop::eu::orders', 'shop::eu::orders')
		expect(writes).toEqual(['shop::eu::orders'])
	})

	it('drops a write whose visit never landed', () => {
		const writes = ['shop::eu::orders', 'shop::eu::customers']
		settleUrlWrite(writes, 'shop::eu::orders', 'shop::eu::customers')
		expect(writes).toEqual(['shop::eu::customers'])
		settleUrlWrite(writes, 'shop::us::orders', null)
		expect(writes).toEqual(['shop::eu::customers'])
	})
})

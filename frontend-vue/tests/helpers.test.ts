import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { parseDraft } from '../app/build/data/cellValues'
import { undoBodies, useStagedEdits } from '../app/build/data/stagedEdits'
import { DiagramHistory } from '../app/build/diagram/history'
import { toCsv } from '../app/build/query/csv'
import {
	closestTable,
	groupByDay,
	runKind,
	unknownTable,
} from '../app/build/query/runs'
import { readQueryTarget } from '../app/build/query/target'
import {
	decodeMatch,
	tableAccess,
	tableLink,
} from '../app/build/utils/databaseLinks'
import type { HistoryEntry } from '../app/build/composables/useQueryStore'

afterEach(() => vi.unstubAllGlobals())

describe('cell drafts', () => {
	it('keeps the stored type of a cell', () => {
		expect(parseDraft('42.5', 1, 'number')).toEqual({
			ok: true,
			value: 42.5,
			unchanged: false,
		})
		expect(parseDraft('nope', 1, 'number')).toEqual({
			ok: false,
			reason: 'number',
		})
		expect(parseDraft('TRUE', false, 'boolean')).toMatchObject({
			ok: true,
			value: true,
		})
	})

	it('types an empty cell from its column and leaves it empty when nothing is typed', () => {
		expect(parseDraft('7', null, 'number')).toMatchObject({
			ok: true,
			value: 7,
		})
		expect(parseDraft('', null, 'string')).toMatchObject({
			ok: true,
			unchanged: true,
		})
	})

	it('reports an echo of the stored value as unchanged', () => {
		expect(parseDraft('42', 42, 'number')).toMatchObject({ unchanged: true })
	})
})

describe('staged edits', () => {
	function staged() {
		vi.stubGlobal('useDmsState', (_key: string, init: () => unknown) =>
			ref(init()),
		)
		return useStagedEdits()
	}

	it('keeps the first stored value and drops a cell set back to it', () => {
		const edits = staged()
		edits.stage('tab', {
			rowId: 'r1',
			field: 'status',
			before: 'pending',
			after: 'paid',
		})
		edits.stage('tab', {
			rowId: 'r1',
			field: 'status',
			before: 'paid',
			after: 'refunded',
		})
		expect(edits.get('tab', 'r1', 'status')).toEqual({
			before: 'pending',
			after: 'refunded',
		})
		edits.stage('tab', {
			rowId: 'r1',
			field: 'status',
			before: 'refunded',
			after: 'pending',
		})
		expect(edits.count('tab')).toBe(0)
	})

	it('writes each row once with all its fields, and undoes with the old values', () => {
		const edits = staged()
		edits.stage('tab', { rowId: 'r1', field: 'a', before: 1, after: 2 })
		edits.stage('tab', { rowId: 'r1', field: 'b', before: null, after: 'x' })
		expect(edits.rowBody('tab', 'r1')).toEqual({ a: 2, b: 'x' })
		expect(undoBodies(edits.list('tab')).get('r1')).toEqual({ a: 1, b: null })
	})
})

describe('diagram history', () => {
	it('squashes a burst of moves of one table into one step', () => {
		const state = { positions: {}, notes: [] }
		const history = new DiagramHistory()
		history.push(
			{
				kind: 'tableMove',
				tableName: 't',
				from: { x: 0, y: 0 },
				to: { x: 5, y: 0 },
			},
			1000,
		)
		history.push(
			{
				kind: 'tableMove',
				tableName: 't',
				from: { x: 5, y: 0 },
				to: { x: 9, y: 0 },
			},
			1100,
		)
		expect(history.undo(state)).toBe(true)
		expect(state.positions).toEqual({ t: { x: 0, y: 0 } })
		expect(history.canUndo).toBe(false)
		expect(history.redo(state)).toBe(true)
		expect(state.positions).toEqual({ t: { x: 9, y: 0 } })
	})
})

describe('query console helpers', () => {
	const entry = (patch: Partial<HistoryEntry>): HistoryEntry => ({
		id: '1',
		userId: 'u',
		query: {},
		source: '',
		language: 'aql',
		executedAt: '2026-10-07T10:00:00.000Z',
		durationMs: 10,
		rowCount: 1,
		status: 'ok',
		mutation: false,
		...patch,
	})

	it('tells runs apart', () => {
		expect(runKind(entry({}))).toBe('fast')
		expect(runKind(entry({ durationMs: 400 }))).toBe('slow')
		expect(runKind(entry({ mutation: true }))).toBe('changed')
		expect(runKind(entry({ status: 'error' }))).toBe('failed')
	})

	it('groups runs by day, newest first', () => {
		const groups = groupByDay(
			[
				entry({ id: 'a', executedAt: '2026-10-07T10:00:00' }),
				entry({ id: 'b', executedAt: '2026-10-06T10:00:00' }),
			],
			(run) => run.executedAt,
		)
		expect(groups.map((group) => group.items.map((run) => run.id))).toEqual([
			['a'],
			['b'],
		])
	})

	it('suggests the table a mistyped name was meant to be', () => {
		expect(unknownTable('Unknown table "invoice" in schema shop')).toBe(
			'invoice',
		)
		expect(closestTable('invoice', ['orders', 'invoices', 'customers'])).toBe(
			'invoices',
		)
		expect(closestTable('zzz', ['orders'])).toBeNull()
	})

	it('reads the target of an encoded query', () => {
		const encoded = {
			__cls: 'Selection',
			stages: [
				{ stage: 'schema', options: { id: 'shop' }, args: [] },
				{ stage: 'instance', options: { id: 'eu' }, args: [] },
				{ stage: 'table', options: { id: 'orders' }, args: [] },
			],
		}
		expect(readQueryTarget(encoded)).toEqual({
			schema: 'shop',
			instance: 'eu',
			table: 'orders',
		})
	})

	it('quotes CSV cells that need it', () => {
		expect(
			toCsv([
				{ a: 'x,y', b: { c: 1 } },
				{ a: null, d: 'say "hi"' },
			]),
		).toBe('a,b,d\n"x,y","{""c"":1}",\n,,"say ""hi"""\n')
	})
})

describe('links', () => {
	it('builds the DSL and page links of a table', () => {
		expect(tableAccess({ schema: 'dms-core', table: 'users' })).toBe(
			'schemas["dms-core"].instance().table("users")',
		)
		expect(
			tableLink('data', {
				schema: 'shop',
				table: 'orders',
				instance: 'eu',
				match: { field: '_id', value: 'a:b' },
			}),
		).toBe(
			'/modules/database/data?schema=shop&table=orders&instance=eu&match=_id%3Aa%3Ab',
		)
		expect(decodeMatch('_id:a:b')).toEqual({ field: '_id', value: 'a:b' })
		expect(decodeMatch('nope')).toBeNull()
	})
})

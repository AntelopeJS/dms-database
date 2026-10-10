import { describe, expect, it } from 'vitest'
import {
	EMPTY_FILTER_STATE,
	filterParams,
	isFiltered,
	parseHas,
	readFilterState,
	sourceQuery,
	toggleHas,
	withFilterState,
	withScope,
} from '../app/build/schemas/filterState'
import {
	compareValues,
	initialSorting,
	sanitizeSorting,
	sortRows,
	sortingPreferencePath,
} from '../app/build/schemas/tableViewSort'
import { SCHEMAS_TABLE_VIEW } from '../app/build/schemas/useSchemasListing'

describe('Schemas filter bar state', () => {
	it('reads nothing as no filter, empty values included', () => {
		expect(readFilterState({})).toEqual(EMPTY_FILTER_STATE)
		// The Inspect URL writes every key, empty when unset.
		const fromInspect = { scope: '', instance: '', q: '', has: '' }
		expect(readFilterState(fromInspect)).toEqual(EMPTY_FILTER_STATE)
		expect(isFiltered(readFilterState(fromInspect))).toBe(false)
	})

	it('reads and writes back every key', () => {
		const query = {
			scope: 'shop',
			instance: 'eu',
			q: ' invoice ',
			has: 'empty,relations',
		}
		const state = readFilterState(query)
		expect(state).toEqual({
			scope: 'shop',
			instance: { kind: 'named', id: 'eu' },
			q: 'invoice',
			has: ['relations', 'empty'],
		})
		expect(filterParams(state)).toEqual({
			scope: 'shop',
			instance: 'eu',
			q: 'invoice',
			has: 'relations,empty',
		})
		expect(isFiltered(state)).toBe(true)
	})

	it('keeps the inspector keys and drops unset and empty bar keys', () => {
		const query = {
			schema: 'shop',
			table: 'orders',
			scope: 'shop',
			instance: '',
			q: '',
			has: '',
		}
		expect(withFilterState(query, readFilterState(query))).toEqual({
			schema: 'shop',
			table: 'orders',
			scope: 'shop',
		})
		expect(
			withFilterState(query, { ...EMPTY_FILTER_STATE, q: 'line' }),
		).toEqual({ schema: 'shop', table: 'orders', q: 'line' })
	})

	it('reads no instance as the default one, and all as every instance', () => {
		expect(readFilterState({}).instance).toEqual({ kind: 'default' })
		expect(readFilterState({ instance: 'all' }).instance).toEqual({
			kind: 'all',
		})
		const named = readFilterState({ instance: 'eu' })
		expect(named.instance).toEqual({ kind: 'named', id: 'eu' })
		expect(filterParams(EMPTY_FILTER_STATE).instance).toBeUndefined()
		expect(
			filterParams({ ...EMPTY_FILTER_STATE, instance: { kind: 'all' } })
				.instance,
		).toBe('all')
		expect(
			isFiltered({ ...EMPTY_FILTER_STATE, instance: { kind: 'all' } }),
		).toBe(true)
	})

	it('keeps known structure flags once, in a fixed order', () => {
		expect(parseHas('empty, bogus,relations,empty')).toEqual([
			'relations',
			'empty',
		])
		let state = toggleHas(EMPTY_FILTER_STATE, 'empty')
		state = toggleHas(state, 'relations')
		expect(state.has).toEqual(['relations', 'empty'])
		expect(toggleHas(state, 'empty').has).toEqual(['relations'])
	})

	it('drops a named instance with the schema it belongs to', () => {
		const state = {
			...EMPTY_FILTER_STATE,
			scope: 'shop',
			instance: { kind: 'named' as const, id: 'eu' },
		}
		expect(withScope(state, 'shop').instance).toEqual(state.instance)
		expect(withScope(state, 'blog').instance).toEqual({ kind: 'default' })
		expect(withScope(state, null).instance).toEqual({ kind: 'default' })
		const every = { ...state, instance: { kind: 'all' as const } }
		expect(withScope(every, 'blog').instance).toEqual({ kind: 'all' })
	})

	it('queries the source as the table view does', () => {
		expect(sourceQuery(EMPTY_FILTER_STATE)).toEqual({})
		expect(
			sourceQuery(
				readFilterState({ scope: 'shop', instance: 'all', has: 'empty' }),
			),
		).toEqual({
			filter_scope: 'is:shop',
			filter_instance: 'is:all',
			filter_has: 'is:empty',
		})
	})
})

interface Row extends Record<string, unknown> {
	name: string
	schema: string
	elementCount: number
}

const ROWS: Row[] = [
	{ name: 'orders', schema: 'shop', elementCount: 12 },
	{ name: 'table10', schema: 'demo', elementCount: 0 },
	{ name: 'customers', schema: 'shop', elementCount: 12 },
	{ name: 'table9', schema: 'demo', elementCount: 3 },
	{ name: 'Audit', schema: 'core', elementCount: 120 },
]

const names = (rows: Row[]) => rows.map((row) => row.name)

describe('Schemas table view order (J / K)', () => {
	const { sortable, defaultSort } = SCHEMAS_TABLE_VIEW

	it('reads the sort where the table view keeps it', () => {
		expect(
			sortingPreferencePath('tables', 'modules.database.explore.schemas'),
		).toBe('tables.tables.modules.database.explore.schemas.sorting')
	})

	it('opens on the saved sort, else the default one', () => {
		expect(initialSorting(undefined, { defaultSort, sortable })).toEqual([
			{ id: 'elementCount', desc: true },
		])
		expect(
			initialSorting([{ id: 'name', desc: false }], { defaultSort, sortable }),
		).toEqual([{ id: 'name', desc: false }])
		// The user turned the sort off: the source's order.
		expect(initialSorting([], { defaultSort, sortable })).toEqual([])
	})

	it('drops a sort on a column the table view cannot sort', () => {
		expect(
			sanitizeSorting([{ id: 'relations', desc: true }], sortable),
		).toEqual([])
		expect(
			sanitizeSorting(
				[
					{ id: 'schema', desc: 1 },
					{ id: 'name', desc: true },
				],
				sortable,
			),
		).toEqual([{ id: 'schema', desc: false }])
		expect(sanitizeSorting('nope', sortable)).toEqual([])
	})

	it('steps through the most rows first by default, equal counts in source order', () => {
		expect(names(sortRows(ROWS, [defaultSort]))).toEqual([
			'Audit',
			'orders',
			'customers',
			'table9',
			'table10',
		])
	})

	it('follows a text sort, numbers in order, either way', () => {
		const ascending = names(sortRows(ROWS, [{ id: 'name', desc: false }]))
		expect(ascending.indexOf('table9')).toBeLessThan(
			ascending.indexOf('table10'),
		)
		expect(names(sortRows(ROWS, [{ id: 'name', desc: true }]))).toEqual(
			[...ascending].reverse(),
		)
		// Stable: within a schema, the source's order.
		expect(names(sortRows(ROWS, [{ id: 'schema', desc: false }]))).toEqual([
			'Audit',
			'table10',
			'table9',
			'orders',
			'customers',
		])
	})

	it('keeps the source order without a sort, and never moves the source', () => {
		const source = [...ROWS]
		expect(names(sortRows(source, []))).toEqual(names(ROWS))
		sortRows(source, [defaultSort])
		expect(source).toEqual(ROWS)
	})

	it('compares numbers as numbers and the rest as text', () => {
		expect(compareValues(2, 10)).toBeLessThan(0)
		expect(compareValues('2', '10')).toBeLessThan(0)
		expect(compareValues(null, 'a')).toBeLessThan(0)
	})
})

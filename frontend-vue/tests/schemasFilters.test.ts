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

describe('Schemas filter bar state', () => {
	it('reads nothing as no filter, empty values included', () => {
		expect(readFilterState({})).toEqual(EMPTY_FILTER_STATE)
		const empty = { scope: '', instance: '', q: '', has: '' }
		expect(readFilterState(empty)).toEqual(EMPTY_FILTER_STATE)
		expect(isFiltered(readFilterState(empty))).toBe(false)
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

	it('keeps the other keys and drops unset and empty bar keys', () => {
		const query = {
			record: 'shop::orders',
			scope: 'shop',
			instance: '',
			q: '',
			has: '',
		}
		expect(withFilterState(query, readFilterState(query))).toEqual({
			record: 'shop::orders',
			scope: 'shop',
		})
		expect(
			withFilterState(query, { ...EMPTY_FILTER_STATE, q: 'line' }),
		).toEqual({ record: 'shop::orders', q: 'line' })
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

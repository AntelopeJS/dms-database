import { describe, expect, it } from 'vitest'
import type { SchemaSummary } from '../app/build/composables/useDatabaseSchemas'
import {
	prepareQueryPayload,
	QueryInputError,
} from '../app/build/composables/useQueryRuntime'
import {
	buildCompletionIndex,
	countedInstance,
	fieldsAt,
	QUERY_METHODS,
} from '../app/build/query/completion'
import { filledColumns, numericColumns } from '../app/build/query/csv'
import { DRAFT_KEY, readDraft, writeDraft } from '../app/build/query/draft'
import { latestOrderField } from '../app/build/query/examples'
import {
	closestName,
	replaceName,
	RUN_DOT_CLASSES,
	unknownName,
	unknownTable,
} from '../app/build/query/runs'
import { findSyntaxProblem } from '../app/build/query/syntax'
import {
	instanceArgument,
	rowInstance,
	runTarget,
	targetFromSource,
} from '../app/build/query/target'

function table(name: string, fields: string[]) {
	return {
		name,
		fields: Object.fromEntries(
			fields.map((field) => [field, { kind: 'string' }]),
		),
		indexes: {},
		relations: [],
	} as SchemaSummary['tables'][number]
}

const shop: SchemaSummary = {
	id: 'shop',
	options: {},
	tables: [
		table('orders', ['status', 'total']),
		table('products', ['sku', 'price']),
	],
	stats: { tableCount: 2, elementCount: 0, instanceCount: 2 },
	instances: ['eu', 'us'],
}

describe('unknown names', () => {
	it('reads the schema, instance or table an error names', () => {
		expect(unknownName('Unknown instance "zz" in schema shop')).toEqual({
			kind: 'instance',
			name: 'zz',
		})
		expect(unknownName('Unknown schema "shoop". Did you mean')).toEqual({
			kind: 'schema',
			name: 'shoop',
		})
		expect(unknownTable('Unknown table "oders" in schema shop')).toBe('oders')
		expect(unknownTable('Unknown instance "zz"')).toBeNull()
	})

	it('suggests the closest instance, as for a table', () => {
		expect(closestName('zz', ['eu', 'us'])).toBe('eu')
		expect(closestName('euu', ['eu', 'us'])).toBe('eu')
		expect(closestName('germany', ['eu', 'us'])).toBeNull()
		expect(closestName('shoop', ['shop', 'demo'])).toBe('shop')
	})

	it('replaces the mistyped name where the query names it', () => {
		const source = 'schemas.shoop.instance("zz").table(\'oders\').count()'
		expect(replaceName(source, 'schema', 'shoop', 'shop')).toBe(
			'schemas.shop.instance("zz").table(\'oders\').count()',
		)
		expect(replaceName(source, 'instance', 'zz', 'eu')).toBe(
			'schemas.shoop.instance("eu").table(\'oders\').count()',
		)
		expect(replaceName(source, 'table', 'oders', 'orders')).toBe(
			'schemas.shoop.instance("zz").table(\'orders\').count()',
		)
		expect(
			replaceName('schemas["shoop"].instance()', 'schema', 'shoop', 'dms-core'),
		).toBe('schemas["dms-core"].instance()')
		// A longer schema id sharing the prefix is left alone.
		expect(replaceName('schemas.shoppers', 'schema', 'shop', 'x')).toBe(
			'schemas.shoppers',
		)
	})
})

describe('query runtime errors', () => {
	it('names an unknown schema with the closest one', () => {
		let error: unknown
		try {
			prepareQueryPayload('schemas.shoop.instance().table("orders")', [shop])
		} catch (caught) {
			error = caught
		}
		expect(error).toBeInstanceOf(QueryInputError)
		expect((error as QueryInputError).problem).toEqual({
			kind: 'unknown_schema',
			schema: 'shoop',
			suggestion: 'shop',
		})
		expect((error as Error).message).toBe(
			'Unknown schema "shoop". Did you mean "shop"?',
		)
	})

	it('points a syntax error at the bracket left open', () => {
		let error: unknown
		try {
			prepareQueryPayload('schemas.shop.instance("eu").table("orders"', [shop])
		} catch (caught) {
			error = caught
		}
		expect(error).toBeInstanceOf(QueryInputError)
		expect((error as QueryInputError).problem).toMatchObject({
			kind: 'syntax',
			syntax: { kind: 'unclosed', char: '(', line: 1, column: 34 },
		})
		expect((error as Error).message).not.toMatch(/;/)
	})

	it('accepts a closing semicolon', () => {
		const prepared = prepareQueryPayload(
			'schemas.shop.instance().table("orders").count();\n',
			[shop],
		)
		expect(prepared.source).toBe(
			'schemas.shop.instance().table("orders").count();',
		)
	})
})

describe('syntax problems', () => {
	it('finds unbalanced brackets and strings with their place', () => {
		expect(findSyntaxProblem('a.b("x").c(1)')).toBeNull()
		expect(findSyntaxProblem('a.b("x"\n  .c(1))')).toBeNull()
		expect(findSyntaxProblem('a.b(1))')).toEqual({
			kind: 'unexpected',
			char: ')',
			expected: undefined,
			line: 1,
			column: 7,
		})
		expect(findSyntaxProblem('a.b([1)')).toMatchObject({
			kind: 'unexpected',
			char: ')',
			expected: ']',
		})
		expect(findSyntaxProblem('a.b(\n  "open)')).toEqual({
			kind: 'string',
			char: '"',
			line: 2,
			column: 3,
		})
		// Brackets in strings and comments do not count.
		expect(findSyntaxProblem('a.b(")") // (\n')).toBeNull()
	})
})

describe('query targets', () => {
	it('reads the chain a query text names', () => {
		expect(
			targetFromSource('schemas.shop.instance("eu").table("orders").count()'),
		).toEqual({ schema: 'shop', instance: 'eu', table: 'orders' })
		expect(
			targetFromSource(
				'schemas["dms-core"].instance(CROSS_INSTANCE).table(\'users\')',
			),
		).toEqual({ schema: 'dms-core', instance: '*', table: 'users' })
		expect(targetFromSource('schemas.demo.instance().table("tags')).toEqual({
			schema: 'demo',
			instance: '',
			table: undefined,
		})
		expect(targetFromSource('1 + 1')).toEqual({})
	})

	it('names where a past run pointed, failed ones included', () => {
		expect(
			runTarget({
				query: {
					stages: [
						{ stage: 'schema', options: { id: 'shop' } },
						{ stage: 'instance', options: { id: 'eu' } },
						{ stage: 'table', options: { id: 'orders' } },
					],
				},
				source: 'whatever',
			}),
		).toEqual({ schema: 'shop', instance: 'eu', table: 'orders' })
		expect(
			runTarget({ query: {}, source: 'schemas.demo.instance().table("tags"' }),
		).toEqual({ schema: 'demo', instance: '', table: undefined })
	})

	it('opens a row of a cross-instance read in its own instance', () => {
		const all = { schema: 'shop', table: 'orders', instance: '*' }
		expect(rowInstance(all, { _id: 'o1', _instance: 'eu' })).toBe('eu')
		expect(rowInstance(all, { _id: 'o1', _instance: null })).toBe('')
		expect(rowInstance(all, { _id: 'o1' })).toBeNull()
		expect(rowInstance({ ...all, instance: 'us' }, { _instance: 'eu' })).toBe(
			'us',
		)
		expect(rowInstance({ ...all, instance: '' }, {})).toBe('')
	})

	it('reads the instance a link into the console names', () => {
		expect(instanceArgument(undefined)).toBe('')
		expect(instanceArgument('__DEFAULT__')).toBe('')
		expect(instanceArgument('eu')).toBe('"eu"')
		expect(instanceArgument('all')).toBe('CROSS_INSTANCE')
		expect(instanceArgument('__CROSS_INSTANCE__')).toBe('CROSS_INSTANCE')
		expect(instanceArgument('*')).toBe('CROSS_INSTANCE')
	})
})

describe('completions', () => {
	const index = buildCompletionIndex([shop])

	it('offers only methods the query language has', () => {
		expect(QUERY_METHODS).not.toContain('limit')
		expect(QUERY_METHODS).toContain('slice')
	})

	it('offers the fields of the chain table only', () => {
		expect(fieldsAt(index, { schema: 'shop', table: 'orders' })).toEqual([
			'status',
			'total',
		])
		expect(fieldsAt(index, { schema: 'shop' })).toEqual([
			'status',
			'total',
			'sku',
			'price',
		])
		expect(fieldsAt(index, { schema: 'shop', table: 'nope' })).toHaveLength(4)
	})

	it('counts tables in the instance the chain names', () => {
		expect(countedInstance(index, { schema: 'shop', instance: '' })).toBe('')
		expect(countedInstance(index, { schema: 'shop', instance: 'eu' })).toBe(
			'eu',
		)
		expect(countedInstance(index, { schema: 'shop', instance: '*' })).toBe('*')
		expect(
			countedInstance(index, { schema: 'shop', instance: 'zz' }),
		).toBeUndefined()
		expect(countedInstance(index, { schema: 'nope' })).toBeUndefined()
	})
})

describe('result rendering', () => {
	it('leaves out columns null in every row and right-aligns numbers', () => {
		const rows = [
			{ _id: 'a', total: 3, _instance: null, note: null },
			{ _id: 'b', total: null, _instance: null, note: 'x' },
		]
		const columns = ['_id', 'total', '_instance', 'note']
		expect(filledColumns(rows, columns)).toEqual(['_id', 'total', 'note'])
		expect(filledColumns([{ a: null }], ['a'])).toEqual(['a'])
		expect(numericColumns(rows, columns)).toEqual(['total'])
	})

	it('orders "latest rows" by a date only when the table has one', () => {
		expect(
			latestOrderField({
				name: 'orders',
				fields: { status: { kind: 'string' }, created_at: { kind: 'date' } },
			}),
		).toBe('created_at')
		expect(
			latestOrderField({ name: 'logs', fields: { at: { kind: 'date' } } }),
		).toBe('at')
		expect(
			latestOrderField({ name: 'tags', fields: { label: { kind: 'string' } } }),
		).toBeNull()
	})

	it('tells a run that changed data from a fast one', () => {
		expect(RUN_DOT_CLASSES.changed).not.toBe(RUN_DOT_CLASSES.fast)
	})
})

describe('query draft', () => {
	function memoryStorage() {
		const items = new Map<string, string>()
		return {
			getItem: (key: string) => items.get(key) ?? null,
			setItem: (key: string, value: string) => void items.set(key, value),
			removeItem: (key: string) => void items.delete(key),
			items,
		}
	}

	it('keeps the query being written for the browser tab', () => {
		const store = memoryStorage()
		writeDraft({ source: 'schemas.shop', savedId: null }, store)
		expect(readDraft(store)).toEqual({ source: 'schemas.shop', savedId: null })
		writeDraft({ source: '  ', savedId: null }, store)
		expect(store.items.has(DRAFT_KEY)).toBe(false)
		store.setItem(DRAFT_KEY, '{broken')
		expect(readDraft(store)).toBeNull()
	})
})

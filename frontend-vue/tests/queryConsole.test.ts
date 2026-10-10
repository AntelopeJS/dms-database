import { describe, expect, it } from 'vitest'
import type { SchemaSummary } from '../app/build/composables/useDatabaseSchemas'
import {
	findSyntaxPlace,
	prepareQueryPayload,
	QueryInputError,
} from '../app/build/composables/useQueryRuntime'
import {
	buildCompletionIndex,
	fieldsAt,
	QUERY_METHODS,
} from '../app/build/query/completion'
import { latestOrderField } from '../app/build/query/examples'
import {
	closestName,
	replaceName,
	RUN_DOT_CLASSES,
	unknownName,
} from '../app/build/query/runs'
import { filledColumns, numericColumns } from '../app/build/query/tableColumns'
import {
	instanceArgument,
	rowInstance,
	runTarget,
	targetFromSource,
	withInstance,
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
		expect(unknownName('Unknown table "oders" in schema shop')).toEqual({
			kind: 'table',
			name: 'oders',
		})
		expect(unknownName('Syntax error')).toBeNull()
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
	it('names an unknown schema', () => {
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
		})
		expect((error as Error).message).toBe('Unknown schema "shoop"')
	})

	it('points a syntax error where the text breaks', () => {
		let error: unknown
		try {
			prepareQueryPayload('schemas.shop.instance("eu").table("orders"', [shop])
		} catch (caught) {
			error = caught
		}
		expect(error).toBeInstanceOf(QueryInputError)
		expect((error as QueryInputError).problem).toMatchObject({
			kind: 'syntax',
			place: { line: 1, column: 43 },
		})
		expect((error as Error).message).toMatch(/^Syntax error at line 1/)
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

describe('syntax places', () => {
	it('finds where the parser stops, with its line and column', () => {
		expect(findSyntaxPlace('a.b("x").c(1)')).toBeNull()
		expect(findSyntaxPlace('a.b("x"\n  .c(1))')).toBeNull()
		expect(findSyntaxPlace('a.b(1))')).toEqual({ line: 1, column: 7 })
		// An unterminated string breaks where the text ends.
		expect(findSyntaxPlace('a.b(\n  "open)')).toEqual({ line: 2, column: 9 })
		// Brackets in strings and comments do not count.
		expect(findSyntaxPlace('a.b(")") // (\n')).toBeNull()
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
		expect(instanceArgument('eu')).toBe('"eu"')
		expect(instanceArgument('all')).toBe('CROSS_INSTANCE')
		// No alias: any other value is a named instance.
		expect(instanceArgument('__CROSS_INSTANCE__')).toBe('"__CROSS_INSTANCE__"')
	})

	it('reads an empty default-instance read in a named instance', () => {
		expect(
			withInstance(
				'schemas.shop.instance().table("orders").filter((r) => r.key("x"))',
				'shop',
				'eu',
			),
		).toBe(
			'schemas.shop.instance("eu").table("orders").filter((r) => r.key("x"))',
		)
		expect(
			withInstance(
				'schemas["dms-core"] . instance( ).table("users")',
				'dms-core',
				'us',
			),
		).toBe('schemas["dms-core"] . instance("us").table("users")')
		// Another schema, or one sharing the prefix, is left alone.
		expect(
			withInstance('schemas.shopper.instance().table("x")', 'shop', 'eu'),
		).toBe('schemas.shopper.instance().table("x")')
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

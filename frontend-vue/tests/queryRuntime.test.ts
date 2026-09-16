import { expect, it } from 'vitest'
import type { SchemaSummary } from '../app/composables/useDatabaseSchemas'
import { prepareQueryPayload } from '../app/composables/useQueryRuntime'

const schema: SchemaSummary = {
	id: 'parity',
	options: {},
	tables: [
		{
			name: 'posts',
			fields: {},
			indexes: {},
			relations: [],
		},
	],
	stats: { tableCount: 1, elementCount: 57, instanceCount: 1 },
	instances: ['default'],
}

it('serializes a staged browser query without execution methods', () => {
	const prepared = prepareQueryPayload(
		'schemas.parity.instance("default").table("posts").slice(0, 10)',
		[schema],
	)

	expect(prepared).toEqual({
		source: 'schemas.parity.instance("default").table("posts").slice(0, 10)',
		hasMutations: false,
		query: {
			__cls: 'Table',
			stages: [
				{ stage: 'schema', options: { id: 'parity' }, args: [] },
				{
					stage: 'instance',
					options: { id: 'default' },
					args: [],
				},
				{ stage: 'table', options: { id: 'posts' }, args: [] },
				{ stage: 'slice', args: [0, 10] },
			],
		},
	})
})

it('marks staged mutations for confirmation', () => {
	const prepared = prepareQueryPayload(
		'schemas.parity.instance("default").table("posts").get("post-000").update({ title: "Changed" })',
		[schema],
	)

	expect(prepared.hasMutations).toBe(true)
	expect(prepared.query.__cls).toBe('Query')
})

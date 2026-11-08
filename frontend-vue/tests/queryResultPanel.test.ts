import { describe, expect, it } from 'vitest'
import { serverRender } from './fixtures/serverRender'
import QueryResultPanel from '../app/components/QueryResultPanel.vue'

const SERVER_CAP = 1000

const result = (count: number) => ({
	rows: Array.from({ length: count }, (_, index) => ({
		_id: `reading-${index}`,
		value: index,
	})),
	rowCount: count,
	truncated: false,
	mutation: false,
	executedAt: '2026-11-08T10:00:00.000Z',
	durationMs: 12,
})

const renderResult = (count: number) =>
	serverRender(
		QueryResultPanel,
		{
			result: result(count),
			failure: null,
			target: { schema: 'metrics', table: 'readings', instance: '' },
			schemas: [],
		},
		{ url: '/modules/database/query', respond: () => ({}) },
	)

describe('query result table', () => {
	it('shows every row the server returns, up to its 1,000-row cap', async () => {
		const { html } = await renderResult(SERVER_CAP)
		expect(html).toContain('reading-0<')
		expect(html).toContain(`reading-${SERVER_CAP - 1}<`)
		expect(html).toContain(`dms_database.query.result.all_shown ${SERVER_CAP}`)
	})
})

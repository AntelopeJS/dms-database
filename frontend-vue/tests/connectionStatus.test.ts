import { describe, expect, it } from 'vitest'
import { browserMount, type BackendRead } from './fixtures/serverRender'
import ConnectionStatus from '../app/components/ConnectionStatus.vue'

function healthWith(driver: string | null) {
	return ({ url }: BackendRead): unknown =>
		url === '/api/database/health'
			? {
					status: 'ok',
					latencyMs: 3,
					driver,
					checkedAt: '2026-10-18T10:00:00.000Z',
					storage: [],
				}
			: { items: [] }
}

describe('overview connection card: the database name before the probe age', () => {
	it('shows a dash when driverLabel is unset', async () => {
		const page = browserMount(ConnectionStatus, healthWith(null))
		await page.shown
		expect(page.text()).toMatch(
			/since="— · dms_database\.overview\.connection\.checked_/,
		)
		expect(page.errors).toEqual([])
	})

	it('shows the configured driverLabel', async () => {
		const page = browserMount(ConnectionStatus, healthWith('MongoDB 8.0'))
		await page.shown
		expect(page.text()).toMatch(
			/since="MongoDB 8\.0 · dms_database\.overview\.connection\.checked_/,
		)
		expect(page.errors).toEqual([])
	})
})

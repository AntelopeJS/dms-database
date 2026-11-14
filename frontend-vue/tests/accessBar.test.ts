import { describe, expect, it, vi } from 'vitest'
import {
	answerConfirmations,
	browserMount,
	confirmations,
} from './fixtures/serverRender'
import {
	OWN,
	WAREHOUSE,
	connectionWrites,
	connectionsBackend,
	connectionsState,
} from './fixtures/connections'
import type { ConnectionsState } from '../app/build/composables/useDatabaseConnections'
import DataBrowserAccessBar from '../app/build/components/DataBrowserAccessBar.vue'

const SWITCH = (props: Record<string, unknown>) =>
	props['data-stub'] === 'DmsInputSwitch'

async function mountBar(state: ConnectionsState, answer?: () => unknown) {
	const page = browserMount(
		DataBrowserAccessBar,
		connectionsBackend(state, { answer }),
	)
	await page.shown
	await vi.waitFor(() => expect(page.reads).not.toHaveLength(0))
	await new Promise((resolve) => setTimeout(resolve, 0))
	return page
}

type Page = Awaited<ReturnType<typeof mountBar>>

function toggle(page: Page, allowed: boolean): void {
	const update = page.find(SWITCH)?.['onUpdate:modelValue']
	expect(update).toBeTypeOf('function')
	if (typeof update === 'function') update(allowed)
}

describe('access bar: what it says', () => {
	it('says read only or read and write for the external database, by its name', async () => {
		const readOnly = await mountBar(connectionsState(WAREHOUSE))
		expect(readOnly.text()).toContain(
			'dms_database.connections.access.read Warehouse',
		)
		const readWrite = await mountBar(
			connectionsState({ ...WAREHOUSE, access: 'read-write' }),
		)
		expect(readWrite.text()).toContain(
			'dms_database.connections.access.read_write Warehouse',
		)
		expect(readWrite.text()).not.toContain(
			'dms_database.connections.access.read Warehouse',
		)
	})

	it('is absent on the project database, which an implementation showing it for every connection gets wrong', async () => {
		const page = await mountBar(connectionsState(OWN))
		expect(page.text()).not.toContain('data-access-bar')
		expect(page.find(SWITCH)).toBeUndefined()
	})

	it('shows the access as text only outside development, with no switch', async () => {
		const page = await mountBar(
			connectionsState(WAREHOUSE, { accessEditable: false }),
		)
		expect(page.text()).toContain(
			'dms_database.connections.access.read Warehouse',
		)
		expect(page.find(SWITCH)).toBeUndefined()
		expect(page.text()).not.toContain('account_read_only')
	})
})

describe('access bar: an account that cannot write', () => {
	it.each([false, null])(
		'locks the switch on read while canWrite is %s, which an implementation that leaves it free gets wrong',
		async (canWrite) => {
			const page = await mountBar(connectionsState({ ...WAREHOUSE, canWrite }))
			expect(page.find(SWITCH)).toMatchObject({ disabled: true })
			expect(page.text()).toContain('name="i-ph-lock"')
		},
	)

	it.each([false, null])(
		'leaves the switch free on read and write while canWrite is %s, so it can go back to read: an implementation locking on canWrite alone traps the access',
		async (canWrite) => {
			const page = await mountBar(
				connectionsState({ ...WAREHOUSE, access: 'read-write', canWrite }, {}),
				() => connectionsState(WAREHOUSE),
			)
			expect(page.find(SWITCH)).toMatchObject({ disabled: false })
			toggle(page, false)
			await vi.waitFor(() =>
				expect(connectionWrites(page.reads)).toEqual([
					{
						method: 'PUT',
						url: '/api/database/connections/warehouse/access',
						body: { access: 'read' },
					},
				]),
			)
		},
	)

	it('tells an account that cannot write from one the catalog did not answer for, which an implementation with one text for both gets wrong', async () => {
		const refused = await mountBar(
			connectionsState({ ...WAREHOUSE, canWrite: false }),
		)
		const unchecked = await mountBar(
			connectionsState({ ...WAREHOUSE, canWrite: null }),
		)
		expect(refused.text()).toContain(
			'dms_database.connections.access.account_read_only',
		)
		expect(refused.text()).not.toContain('account_unverified')
		expect(unchecked.text()).toContain(
			'dms_database.connections.access.account_unverified',
		)
		expect(unchecked.text()).not.toContain('account_read_only')
	})

	it('leaves the switch free, with no account message, when the account can write', async () => {
		const page = await mountBar(connectionsState(WAREHOUSE))
		expect(page.find(SWITCH)).toMatchObject({ disabled: false })
		expect(page.text()).not.toContain('account_read_only')
	})
})

describe('access bar: changing the access', () => {
	it('asks before it allows writes, and writes nothing when the user declines', async () => {
		answerConfirmations(false)
		const page = await mountBar(connectionsState(WAREHOUSE))
		toggle(page, true)
		await vi.waitFor(() => expect(confirmations).toHaveLength(1))
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(connectionWrites(page.reads)).toEqual([])
		expect(confirmations[0]).toMatchObject({
			color: 'warning',
			description:
				'dms_database.connections.access.confirm.description Warehouse',
		})
	})

	it('allows writes once the user confirms, and then shows read and write from the answer', async () => {
		answerConfirmations(true)
		const written = connectionsState({ ...WAREHOUSE, access: 'read-write' })
		const page = await mountBar(connectionsState(WAREHOUSE), () => written)
		toggle(page, true)
		await vi.waitFor(() =>
			expect(page.text()).toContain(
				'dms_database.connections.access.read_write Warehouse',
			),
		)
		expect(confirmations).toHaveLength(1)
		expect(connectionWrites(page.reads)).toEqual([
			{
				method: 'PUT',
				url: '/api/database/connections/warehouse/access',
				body: { access: 'read-write' },
			},
		])
	})

	it('goes back to read without asking', async () => {
		answerConfirmations(false)
		const page = await mountBar(
			connectionsState({ ...WAREHOUSE, access: 'read-write' }),
			() => connectionsState(WAREHOUSE),
		)
		toggle(page, false)
		await vi.waitFor(() =>
			expect(connectionWrites(page.reads)).toEqual([
				{
					method: 'PUT',
					url: '/api/database/connections/warehouse/access',
					body: { access: 'read' },
				},
			]),
		)
		expect(confirmations).toEqual([])
	})

	it('keeps the access it showed when the server refuses the change', async () => {
		answerConfirmations(true)
		const page = await mountBar(connectionsState(WAREHOUSE), () => {
			throw new Error('This account can only read.')
		})
		toggle(page, true)
		await vi.waitFor(() => expect(connectionWrites(page.reads)).toHaveLength(1))
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(page.text()).toContain(
			'dms_database.connections.access.read Warehouse',
		)
		expect(page.errors).toEqual([])
	})
})

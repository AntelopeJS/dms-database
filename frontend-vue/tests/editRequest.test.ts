import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import {
	answerConfirmations,
	browserMount,
	confirmations,
	type Backend,
	type BackendRead,
} from './fixtures/serverRender'
import {
	CONNECTIONS_URL,
	OWN,
	WAREHOUSE,
	connectionsBackend,
	connectionsState,
} from './fixtures/connections'
import type { DatabaseConnection } from '../app/build/composables/useDatabaseConnections'
import type { BrowserTab } from '../app/build/composables/useDataBrowserTabs'
import { useStagedEdits } from '../app/build/data/stagedEdits'
import { useStagedSave } from '../app/build/data/useStagedSave'

const EDIT_URL = '/api/database/browse/edit'
const TAB: BrowserTab = {
	id: 'public::__DEFAULT__::orders',
	schema: 'public',
	instance: '__DEFAULT__',
	table: 'orders',
}

interface ConfirmOptions {
	onConfirm: () => Promise<unknown>
}

function isConfirm(options: unknown): options is ConfirmOptions {
	return (
		typeof options === 'object' &&
		options !== null &&
		'onConfirm' in options &&
		typeof options.onConfirm === 'function'
	)
}

/** Stages one edit, opens the review of the save, and writes it as the dialog's confirm button does. */
async function saveAnEdit(backend: Backend) {
	let review: () => Promise<void> = async () => undefined
	const Harness = defineComponent({
		setup() {
			review = useStagedSave({
				tab: () => TAB,
				onWritten: () => undefined,
				onSaved: () => undefined,
			}).review
			useStagedEdits().stage(TAB.id, {
				rowId: '1',
				field: 'total',
				before: 1,
				after: 2,
			})
			return () => h('div')
		},
	})
	const page = browserMount(Harness, backend)
	await page.shown
	await vi.waitFor(() =>
		expect(page.reads.map((read) => read.url)).toContain(CONNECTIONS_URL),
	)
	await new Promise((resolve) => setTimeout(resolve, 0))
	answerConfirmations(true)
	await review()
	const options = confirmations[0]
	if (!isConfirm(options)) throw new Error('The save asked no confirmation')
	await options.onConfirm()
	return page
}

function backendFor(selected: DatabaseConnection, edit: Backend): Backend {
	const connections = connectionsBackend(connectionsState(selected))
	return (read) => (read.url === EDIT_URL ? edit(read) : connections(read))
}

const edits = (reads: BackendRead[]) =>
	reads.filter((read) => read.url === EDIT_URL)

describe('the edit request', () => {
	it.each([OWN, WAREHOUSE])(
		'names the database the page loaded with: $id, in the query the frontend server relays, which an implementation sending none, or a header the server drops, gets wrong',
		async (selected) => {
			const page = await saveAnEdit(backendFor(selected, () => ({ _id: '1' })))
			expect(edits(page.reads)).toHaveLength(1)
			expect(edits(page.reads)[0]?.query).toMatchObject({
				connection: selected.id,
			})
		},
	)
})

import { expect, it } from 'vitest'
import { inBrowser, type BackendRead } from './fixtures/serverRender'
import { useDiagramPersistence } from '../app/build/composables/useDiagramPersistence'

const NOTE = {
	id: 'n1',
	schemaName: 'public',
	text: '',
	x: 0,
	y: 0,
	width: 200,
	height: 100,
	color: null,
	createdAt: '2026-10-01T10:00:00.000Z',
	updatedAt: '2026-10-01T10:00:00.000Z',
}

function backend({ method }: BackendRead): unknown {
	return method === 'DELETE' || method === 'GET' ? { success: true } : NOTE
}

it('names the database the page loaded with on every diagram write, which a server checking the selection alone would let a stale tab misfile', async () => {
	const browser = inBrowser(
		() => useDiagramPersistence(() => 'warehouse'),
		backend,
	)
	await browser.value.saveLayout('public', { orders: { x: 1, y: 2 } })
	await browser.value.createNote({
		schemaName: 'public',
		text: '',
		x: 0,
		y: 0,
		width: 200,
		height: 100,
	})
	await browser.value.updateNote('n1', { x: 5 })
	await browser.value.deleteNote('n1')
	expect(
		browser.reads.map(({ method, url, query }) => [method, url, query]),
	).toEqual([
		['PUT', '/api/database/diagram/layout/public', { connection: 'warehouse' }],
		['POST', '/api/database/diagram/notes', { connection: 'warehouse' }],
		['PUT', '/api/database/diagram/notes/n1', { connection: 'warehouse' }],
		['DELETE', '/api/database/diagram/notes/n1', { connection: 'warehouse' }],
	])
})

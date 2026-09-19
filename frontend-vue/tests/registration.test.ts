import { expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import frontendModule from '../dms.frontend'

const schemasPage = readFileSync(
	new URL('../app/custom-pages/database/schemas.vue', import.meta.url),
	'utf8',
)
const relationEdge = readFileSync(
	new URL('../app/components/DiagramRelationEdge.vue', import.meta.url),
	'utf8',
)

it('uses the DMS client-only wrapper for the Vue Flow schema diagram', () => {
	expect(schemasPage).toContain('<DmsClientOnly>')
	expect(schemasPage).not.toContain('<ClientOnly>')
})

it('does not route relation labels through Vue Flow EdgeText measurement', () => {
	expect(relationEdge).toContain(':label="undefined"')
	expect(relationEdge).toContain('<text')
})

it('preserves all database page keys, component aliases and preloaders', async () => {
	const registerComponent = vi.fn()
	const registerPage = vi.fn()
	await frontendModule.setup({
		options: { public: {} },
		registerComponent,
		registerPage,
		registerDynamicPage: vi.fn(),
		registerLayout: vi.fn(),
		registerErrorPage: vi.fn(),
		registerPlugin: vi.fn(),
		registerMiddleware: vi.fn(),
		provide: vi.fn(),
		use: vi.fn(),
	})
	expect(registerPage.mock.calls.map(([name]) => name)).toEqual([
		'database/data',
		'database/overview',
		'database/query',
		'database/schemas',
	])
	for (const [name, component, preload] of registerPage.mock.calls) {
		const alias = `DmsDatabase${name.split('/')[1].replace(/^./, (character: string) => character.toUpperCase())}`
		expect(registerComponent).toHaveBeenCalledWith(alias, component)
		expect(preload).toBeTypeOf('function')
	}
	const names = registerComponent.mock.calls.map(([name]) => name)
	expect(names).toContain('DmsDatabaseDataGrid')
	expect(new Set(names).size).toBe(names.length)
})

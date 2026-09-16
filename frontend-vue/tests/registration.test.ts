import { expect, it, vi } from 'vitest'
import frontendModule from '../dms.frontend'

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

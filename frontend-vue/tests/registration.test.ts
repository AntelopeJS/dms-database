import { expect, it, vi } from 'vitest'
import frontendModule from '../dms.frontend'

it('registers every component under the module prefix the backend names', async () => {
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
	expect(frontendModule.componentPrefix).toBe('DmsDatabase')
	expect(registerPage).not.toHaveBeenCalled()
	const names = registerComponent.mock.calls.map(([name]) => name)
	// The names the backend pages send, without the prefix the SDK adds.
	for (const name of [
		'ConnectionStatus',
		'TableInspector',
		'SchemaDiagram',
		'DataBrowser',
		'QueryConsole',
	]) {
		expect(names).toContain(name)
	}
	expect(names.every((name) => !name.startsWith('Dms'))).toBe(true)
	expect(new Set(names).size).toBe(names.length)
})

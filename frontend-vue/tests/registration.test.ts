import { expect, it, vi } from 'vitest'
import type { DmsFrontendSdk } from '#dms/frontend-module'
import frontendModule from '../dms.frontend'
import {
	DATABASE_SWITCHER_WIDGET,
	registerDatabaseSwitcher,
} from '../app/build/composables/registerDatabaseSwitcher'

it('registers every component under the module prefix the backend names', async () => {
	const registerComponent = vi.fn<DmsFrontendSdk['registerComponent']>()
	const registerPage = vi.fn<DmsFrontendSdk['registerPage']>()
	const registerPlugin = vi.fn<DmsFrontendSdk['registerPlugin']>()
	await frontendModule.setup({
		options: { public: {} },
		registerComponent,
		registerPage,
		registerDynamicPage: vi.fn(),
		registerLayout: vi.fn(),
		registerErrorPage: vi.fn(),
		registerPlugin,
		registerMiddleware: vi.fn(),
		registerAccessRedirect: vi.fn(),
		provide: vi.fn(),
		use: vi.fn(),
	})
	expect(registerPlugin).toHaveBeenCalledExactlyOnceWith(
		registerDatabaseSwitcher,
	)
	expect(frontendModule.componentPrefix).toBe('DmsDatabase')
	expect(registerPage).not.toHaveBeenCalled()
	const names = registerComponent.mock.calls.map(([name]) => name)
	for (const name of [
		'ConnectionStatus',
		'TableInspector',
		'SchemaDiagram',
		'DataBrowser',
		'QueryConsole',
	]) {
		expect(names).toContain(name)
	}
	expect(names).toContain(
		DATABASE_SWITCHER_WIDGET.component.replace(
			frontendModule.componentPrefix ?? '',
			'',
		),
	)
	expect(names.every((name) => !name.startsWith('Dms'))).toBe(true)
	expect(new Set(names).size).toBe(names.length)
})

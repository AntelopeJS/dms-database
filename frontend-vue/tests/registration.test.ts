import { expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import frontendModule from '../dms.frontend'

function source(path: string): string {
	return readFileSync(new URL(path, import.meta.url), 'utf8')
}

it('uses the DMS client-only wrapper for the Vue Flow schema diagram', () => {
	const diagram = source('../app/components/SchemaDiagram.vue')
	expect(diagram).toContain('<DmsClientOnly')
	expect(diagram).not.toContain('<ClientOnly>')
})

it('does not route relation labels through Vue Flow EdgeText measurement', () => {
	const edge = source('../app/components/DiagramRelationEdge.vue')
	expect(edge).toContain(':label="undefined"')
	expect(edge).toContain('<text')
})

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

it('names every custom component the backend pages render', () => {
	const backend = ['overview', 'schemas', 'diagram', 'data', 'query']
		.map((page) => source(`../../src/pages/${page}.ts`))
		.join('\n')
	const named = [
		...backend.matchAll(/CustomComponent\("DmsDatabase(\w+)"\)/g),
	].map(([, name]) => name)
	expect(named.length).toBeGreaterThan(0)
	for (const name of named) {
		expect(() => source(`../app/components/${name}.vue`)).not.toThrow()
	}
})

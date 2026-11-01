import { afterEach, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { useDiagramSaveStatus } from '../app/build/composables/useDiagramSaveStatus'
import { DiagramSync } from '../app/build/diagram/sync'
import { DiagramAutosave } from '../app/build/diagram/autosave'

afterEach(() => {
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

it.each([true, false])(
	'keeps an unmarked diagram failure local, without duplicating a refusal (%s)',
	async (marked) => {
		vi.useFakeTimers()
		for (const [name, value] of Object.entries(vue)) vi.stubGlobal(name, value)
		const error = Object.assign(new Error('Forbidden'), {
			response: new Response(null, {
				status: 403,
				headers: marked ? { 'x-dms-readonly': '1' } : {},
			}),
		})
		const notices: string[] = []
		const presented = new WeakSet<Response>()
		const consume = (failure: unknown) => {
			if (failure !== error || !marked) return false
			if (!presented.has(error.response)) notices.push('read-only')
			presented.add(error.response)
			return true
		}
		vi.stubGlobal('useReadOnlyRefusal', () => consume)
		vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
		vi.stubGlobal('useToast', () => ({ add: () => notices.push('local') }))
		const owner = new DiagramSync(
			{
				saveLayout: async () => {
					consume(error)
					throw error
				},
				createNote: async () => {
					throw new Error('not used')
				},
				updateNote: async () => {
					throw new Error('not used')
				},
				deleteNote: async () => undefined,
			},
			'demo',
		)
		const scope = vue.effectScope()
		const status = scope.run(() => useDiagramSaveStatus(() => null))!
		const autosave = new DiagramAutosave(
			owner,
			() => ({ positions: { orders: { x: 12, y: 24 } }, notes: [] }),
			10,
			status.statusReporter(owner),
		)
		autosave.schedule()
		await autosave.flush()
		expect(notices).toEqual([marked ? 'read-only' : 'local'])
		scope.stop()
	},
)

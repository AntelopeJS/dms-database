import { afterEach, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { useApiErrorPresenter } from '#dms-core/app/composables/useApiErrorPresenter'
import { useDiagramSaveStatus } from '../app/build/composables/useDiagramSaveStatus'
import { DiagramSync } from '../app/build/diagram/sync'
import { DiagramAutosave } from '../app/build/diagram/autosave'

afterEach(() => vi.unstubAllGlobals())

it.each([false, true])(
	'shows one translated warning for a refused diagram save (already presented %s)',
	async (alreadyPresented) => {
		for (const [name, value] of Object.entries(vue)) vi.stubGlobal(name, value)
		const data = { message: 'error.read_only_demo', severity: 'warning' }
		const error = Object.assign(new Error('Forbidden'), {
			data,
			response: new Response(JSON.stringify(data), {
				status: 403,
				headers: { 'content-type': 'application/json' },
			}),
		})
		const messages = new Map([
			['error.read_only_demo', 'This demo is read-only.'],
			['dms_database.diagram.save.error_other', 'Could not save the diagram.'],
		])
		const notices: { title: string; color: string }[] = []
		vi.stubGlobal('useToast', () => ({
			add: (notice: (typeof notices)[number]) => {
				notices.push(notice)
				return { id: notices.length }
			},
		}))
		vi.stubGlobal('getPluginI18n', () => ({
			i18n: {
				tm: (key: string) => messages.get(key),
				rt: (text: string) => text,
			},
		}))
		const presented = vue.ref(new WeakMap())
		vi.stubGlobal('useDmsState', () => presented)
		vi.stubGlobal('useApiErrorPresenter', useApiErrorPresenter)
		vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
		const core = useApiErrorPresenter()
		const owner = new DiagramSync(
			{
				saveLayout: async () => {
					if (alreadyPresented)
						core.presentError(error, { fallbackKey: 'error.500.description' })
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
		try {
			const status = scope.run(() => useDiagramSaveStatus(() => null))
			if (!status) throw new Error('Missing save status')
			const autosave = new DiagramAutosave(
				owner,
				() => ({ positions: { orders: { x: 12, y: 24 } }, notes: [] }),
				10,
				status.statusReporter(owner),
			)
			autosave.schedule()
			await autosave.flush()
			expect(notices).toEqual([
				expect.objectContaining({
					title: 'This demo is read-only.',
					color: 'warning',
				}),
			])
		} finally {
			scope.stop()
		}
	},
)

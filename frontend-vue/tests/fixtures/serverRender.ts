/**
 * Server renders of the module's components on the renderer's real data
 * layer (`#dms/frontend-module`) and the DMS's real `useApiData`, as the
 * generated application runs them: what each render reads from the backend,
 * and what it hands the browser with the page.
 */
import * as vue from 'vue'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { vi } from 'vitest'
import type { DmsPayload } from '#dms/frontend-module'

const engine = await import('#dms/frontend-module')
const regional = await import('#dms-core/app/utils/regional')

/** A backend request a render made. */
export interface BackendRead {
	url: string
	method: string
	query: Record<string, unknown>
}

export type Backend = (read: BackendRead) => unknown

interface FetchOptions {
	method?: string
	query?: Record<string, unknown>
	signal?: AbortSignal
}

let backend: Backend = () => ({})
const reads: BackendRead[] = []
/** The options each read was made with, as `useDmsFetch` passed them. */
const readOptions = new WeakMap<BackendRead, FetchOptions>()

const $authFetch = async (url: string, options: FetchOptions = {}) => {
	const read = {
		url,
		method: (options.method ?? 'GET').toUpperCase(),
		query: options.query ?? {},
	}
	reads.push(read)
	readOptions.set(read, options)
	return backend(read)
}

const noop = () => undefined

// The application's auto-imports: Vue's API, the renderer's, the DMS
// layers' the module calls, and the module's own composables.
for (const [name, value] of Object.entries(vue))
	if (/^[a-z]/.test(name)) vi.stubGlobal(name, value)
vi.stubGlobal('useDmsFetch', engine.useDmsFetch)
vi.stubGlobal('useDmsAsyncData', engine.useDmsAsyncData)
vi.stubGlobal('useDmsState', engine.useDmsState)
vi.stubGlobal('useDmsRoute', engine.useDmsRoute)
vi.stubGlobal('useDmsRouter', engine.useDmsRouter)
const { useApiData } = await import('#dms-core/app/composables/auth/useApiData')
vi.stubGlobal('useApiData', useApiData)
// `useFetchAuth`: the former name of `useApiData`.
vi.stubGlobal('useAuthFetch', () => ({ $authFetch, useFetchAuth: useApiData }))
vi.stubGlobal('useI18n', () => ({
	t: (key: string, params?: Record<string, unknown>) =>
		params ? `${key} ${Object.values(params).join(' ')}` : key,
	n: (value: number) => String(value),
	locale: vue.ref('en'),
}))
vi.stubGlobal('useRegionalFormat', () => ({
	locale: vue.ref('en'),
	dateTimeFormat: (options: Intl.DateTimeFormatOptions) =>
		regional.regionalDateTimeFormat('en', options),
}))
vi.stubGlobal('regionalDayKey', regional.regionalDayKey)
vi.stubGlobal('regionalDayNumber', regional.regionalDayNumber)
vi.stubGlobal('useToast', () => ({ add: noop }))
vi.stubGlobal('useConfirm', () => ({ confirm: async () => false }))
vi.stubGlobal('useDrawer', () => ({ open: noop }))
vi.stubGlobal('useUnsavedChanges', noop)
vi.stubGlobal('useDmsUserSession', () => ({
	user: vue.ref({ _id: 'me' }),
	loggedIn: vue.ref(true),
}))
for (const [name, module] of Object.entries({
	useDataBrowserGrid:
		await import('../../app/build/composables/useDataBrowserGrid'),
	useDataBrowserTabs:
		await import('../../app/build/composables/useDataBrowserTabs'),
	useStagedEdits: await import('../../app/build/data/stagedEdits'),
	useDatabaseSchemas:
		await import('../../app/build/composables/useDatabaseSchemas'),
}))
	vi.stubGlobal(name, (module as Record<string, unknown>)[name])

// The DMS's and Nuxt UI's components the module's templates use: each
// renders its default slot, its props as attributes.
const UI_COMPONENTS = [
	'DmsAutoLink',
	'DmsCard',
	'DmsChart',
	'DmsCodeSnippet',
	'DmsEmptyState',
	'DmsEyebrow',
	'DmsFieldRow',
	'DmsFlowCanvas',
	'DmsFormErrorText',
	'DmsFormRequiredLegend',
	'DmsInputCode',
	'DmsInputText',
	'DmsSaveBar',
	'DmsSegmented',
	'DmsStatusSummary',
	'DmsSwitch',
	'DmsTextarea',
	'I18nT',
	'UAlert',
	'UAvatar',
	'UBadge',
	'UButton',
	'UFormField',
	'UIcon',
	'UInput',
	'UKbd',
	'UModal',
	'UPopover',
	'UProgress',
	'USelect',
	'USelectMenu',
	'USkeleton',
	'USlideover',
	'UTabs',
	'UTooltip',
]

const uiStub = (name: string): Component =>
	vue.defineComponent({
		name,
		setup:
			(_, { slots }) =>
			() =>
				h('div', { 'data-stub': name }, slots.default?.()),
	})

export interface ServerRender {
	html: string
	payload: DmsPayload
	/** Every backend request the render made. */
	reads: BackendRead[]
	/** The requests made whose response the payload does not carry. */
	untransferred: BackendRead[]
}

/**
 * The key a `useApiData(url)` read is transferred under, as the renderer
 * gives it (`dmsRequestKey`): a digest of the request, which the payload
 * shows instead of the URL.
 */
function transferKey(read: BackendRead): string | null {
	const { method, query } = readOptions.get(read) ?? {}
	return engine.dmsRequestKey(read.url, { method, query }) ?? null
}

/**
 * Renders `component` with `props` as a server renders the page `url`,
 * answering each backend request with `respond`.
 */
export async function serverRender(
	component: Component,
	props: Record<string, unknown> = {},
	options: { url?: string; respond?: Backend } = {},
): Promise<ServerRender> {
	backend = options.respond ?? (() => ({}))
	reads.length = 0
	const runtime = engine.createDmsFrontendRuntime(undefined, {}, true)
	runtime.route.fullPath = options.url ?? '/'
	const app = createSSRApp({ render: () => h(component, props) })
	engine.provideDmsFrontendRuntime(app, runtime)
	app.component('DmsClientOnly', engine.DmsClientOnly)
	for (const name of UI_COMPONENTS) app.component(name, uiStub(name))
	app.config.warnHandler = noop
	const html = await renderToString(app)
	const payload = engine.serializeDmsPayload(runtime)
	const transferred = new Set(
		Object.keys({ ...payload.data, ...payload.errors }),
	)
	const made = [...reads]
	return {
		html,
		payload,
		reads: made,
		untransferred: made.filter(
			(read) => !transferred.has(transferKey(read) ?? ''),
		),
	}
}

/** What a browser's app context gives a composable, and what it read. */
export interface BrowserContext<T> {
	value: T
	/** Every backend request made since, live. */
	reads: BackendRead[]
}

/**
 * Runs `setup` in a browser's app context (no server render to hydrate),
 * answering each backend request with `respond`.
 */
export function inBrowser<T>(
	setup: () => T,
	respond: Backend,
): BrowserContext<T> {
	backend = respond
	reads.length = 0
	const runtime = engine.createDmsFrontendRuntime(undefined, undefined, false)
	const app = createSSRApp({ render: () => null })
	engine.provideDmsFrontendRuntime(app, runtime)
	const scope = vue.effectScope()
	const value = app.runWithContext(() => scope.run(setup) as T)
	return { value, reads }
}

import * as vue from 'vue'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { vi } from 'vitest'
import type { DmsPayload } from '#dms/frontend-module'

const engine = await import('#dms/frontend-module')
const regional = await import('#dms-core/app/utils/regional')

/** A value a backend request carries or a backend answers with. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue }

/** A backend request a render made. */
export interface BackendRead {
	url: string
	method: string
	query: Record<string, JsonValue>
	body?: JsonValue
	headers?: Record<string, string>
}

/** What a backend answers: the value, or a promise of it for a later answer. */
export type BackendAnswer = JsonValue | Promise<JsonValue>

export type Backend = (read: BackendRead) => BackendAnswer

interface FetchOptions {
	method?: string
	query?: Record<string, JsonValue>
	body?: JsonValue
	headers?: Record<string, string>
	signal?: AbortSignal
}

/** A handler a component put on an element, called with the value it emits. */
export type PropHandler = (value?: MountValue) => void

/** A prop a component put on an element of the browser mount. */
export type MountValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| PropHandler
	| MountValue[]
	| { [key: string]: MountValue }

/** The props of an element of the browser mount. */
export type MountProps = Record<string, MountValue>

/** Whether a prop is a handler a test can call. */
export function isPropHandler(value: MountValue): value is PropHandler {
	return typeof value === 'function'
}

function isText(value: MountValue): value is string {
	return typeof value === 'string'
}

/** What a prop reads as in a rendered attribute: a text as it is, anything else as JSON. */
export function propText(value: MountValue): string {
	return isText(value) ? value : String(JSON.stringify(value))
}

const CONNECTIONS_URL = '/api/database/connections'
/**
 * What the connections read answers when a test's backend says nothing of it:
 * the project database alone, selected.
 */
const OWN_DATABASE_ONLY = {
	selected: 'own',
	accessEditable: false,
	connections: [
		{
			id: 'own',
			kind: 'own',
			label: 'own',
			database: null,
			engine: null,
			access: 'read-write',
			canWrite: true,
			unsupported: [],
			missing: [],
		},
	],
}

function answerIsConnections(
	answer: BackendAnswer,
): answer is { connections: JsonValue[] } {
	return (
		typeof answer === 'object' &&
		answer !== null &&
		!Array.isArray(answer) &&
		!(answer instanceof Promise) &&
		Array.isArray(answer.connections)
	)
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
		body: options.body,
		headers: options.headers,
	}
	reads.push(read)
	readOptions.set(read, options)
	const answer = backend(read)
	if (read.url === CONNECTIONS_URL && read.method === 'GET')
		return answerIsConnections(answer) ? answer : OWN_DATABASE_ONLY
	return answer
}

const noop = () => undefined

for (const [name, value] of Object.entries(vue))
	if (/^[a-z]/.test(name)) vi.stubGlobal(name, value)
vi.stubGlobal('useDmsFetch', engine.useDmsFetch)
vi.stubGlobal('useDmsAsyncData', engine.useDmsAsyncData)
vi.stubGlobal('useDmsState', engine.useDmsState)
vi.stubGlobal('useDmsRoute', engine.useDmsRoute)
vi.stubGlobal('useDmsRouter', engine.useDmsRouter)
const { useApiData } = await import('#dms-core/app/composables/auth/useApiData')
vi.stubGlobal('useApiData', useApiData)
const { useApiErrorPresenter } =
	await import('#dms-core/app/composables/useApiErrorPresenter')
vi.stubGlobal('useApiErrorPresenter', useApiErrorPresenter)
vi.stubGlobal('getPluginI18n', () => ({
	i18n: { tm: (key: string) => key, rt: (text: string) => text },
}))
vi.stubGlobal('useAuthFetch', () => ({ $authFetch, useFetchAuth: useApiData }))
vi.stubGlobal('useI18n', () => ({
	t: (key: string, params?: Record<string, string | number>) =>
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
vi.stubGlobal('useToast', () => ({ add: () => ({ id: 'toast' }) }))
/** The sidebar entries the mounted components locked, as the layer's `useMenuLocks` keeps them. */
export const menuLocks = vue.ref<{ fullId: string; reason: string }[]>([])
vi.stubGlobal('useMenuLocks', () => ({
	locks: menuLocks,
	lock: (entry: { fullId: string; reason: string }) => {
		const known = menuLocks.value.find((lock) => lock.fullId === entry.fullId)
		if (known?.reason === entry.reason) return
		menuLocks.value = [
			...menuLocks.value.filter((known) => known.fullId !== entry.fullId),
			entry,
		]
	},
	unlock: (fullId: string) => {
		if (!menuLocks.value.some((lock) => lock.fullId === fullId)) return
		menuLocks.value = menuLocks.value.filter((known) => known.fullId !== fullId)
	},
}))
vi.stubGlobal('useSiteLayout', () => ({
	findMatchingRoute: (path: string) => ({
		metadata: { fullId: `page${path}` },
	}),
}))
/** What a confirmation dialog is asked, as far as the tests read it. */
export interface ConfirmRequest {
	color?: string
	description?: string
	onConfirm?: () => Promise<void>
}

/** What a drawer's component is given, as far as the tests read it. */
export interface DrawerComponentOptions {
	readOnly?: boolean
	showReferences?: boolean
}

/** The confirmation dialogs the mounted components opened, in order. */
export const confirmations: ConfirmRequest[] = []
let confirmationAnswer = false
/** What the next confirmation dialogs resolve: the user's choice. */
export function answerConfirmations(confirmed: boolean): void {
	confirmationAnswer = confirmed
}
vi.stubGlobal('useConfirm', () => ({
	confirm: async (options: ConfirmRequest) => {
		confirmations.push(options)
		return confirmationAnswer
	},
}))
/** The options of each drawer the mounted components opened, in order. */
export const drawers: { componentOptions?: DrawerComponentOptions }[] = []
vi.stubGlobal('useDrawer', () => ({
	open: (options: { componentOptions?: DrawerComponentOptions }) => {
		drawers.push(options)
		return { result: new Promise(noop), patch: noop }
	},
}))
vi.stubGlobal('resolveDmsComponent', engine.resolveDmsComponent)
vi.stubGlobal('useUnsavedChanges', noop)
vi.stubGlobal('useDmsUserSession', () => ({
	user: vue.ref({ _id: 'me' }),
	loggedIn: vue.ref(true),
}))
const { useDataBrowserGrid } =
	await import('../../app/build/composables/useDataBrowserGrid')
const { useDataBrowserTabs } =
	await import('../../app/build/composables/useDataBrowserTabs')
const { useStagedEdits } = await import('../../app/build/data/stagedEdits')
const { useDatabaseSchemas } =
	await import('../../app/build/composables/useDatabaseSchemas')
vi.stubGlobal('useDataBrowserGrid', useDataBrowserGrid)
vi.stubGlobal('useDataBrowserTabs', useDataBrowserTabs)
vi.stubGlobal('useStagedEdits', useStagedEdits)
vi.stubGlobal('useDatabaseSchemas', useDatabaseSchemas)

const UI_COMPONENTS = [
	'DmsAutoLink',
	'DmsCardPanel',
	'DmsChartBlock',
	'DmsCodeSnippet',
	'DmsContainerFooter',
	'DmsEmptyState',
	'DmsEyebrowLabel',
	'DmsFieldRow',
	'DmsFlowCanvas',
	'DmsFormErrorText',
	'DmsFormRequiredLegend',
	'DmsInputCode',
	'DmsInputText',
	'DmsNavCardGridBlock',
	'DmsSaveBar',
	'DmsSegmentedControl',
	'DmsStatusSummary',
	'DmsInputSwitch',
	'DmsInputTextarea',
	'I18nT',
	'UAlert',
	'UAvatar',
	'UBadge',
	'UButton',
	'UDropdownMenu',
	'UFormField',
	'UIcon',
	'UInput',
	'UKbd',
	'UModal',
	'UPopover',
	'UProgress',
	'USelect',
	'USelectMenu',
	'USeparator',
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

/** A node of the browser mount's tree: an element, a text or a comment. */
interface MountNode {
	tag?: string
	text?: string
	props: MountProps
	children: MountNode[]
	parent: MountNode | null
}

const mountNode = (fields: Partial<MountNode>): MountNode => ({
	props: {},
	children: [],
	parent: null,
	...fields,
})

function detach(node: MountNode): void {
	const siblings = node.parent?.children
	if (siblings) siblings.splice(siblings.indexOf(node), 1)
	node.parent = null
}

const { createApp: createMountApp } = vue.createRenderer<MountNode, MountNode>({
	createElement: (tag) => mountNode({ tag }),
	createText: (text) => mountNode({ text }),
	createComment: () => mountNode({ text: '' }),
	setText: (node, text) => {
		node.text = text
	},
	setElementText: (node, text) => {
		node.children = [mountNode({ text, parent: node })]
	},
	insert: (child, parent, anchor) => {
		detach(child)
		const at = anchor ? parent.children.indexOf(anchor) : -1
		if (at < 0) parent.children.push(child)
		else parent.children.splice(at, 0, child)
		child.parent = parent
	},
	remove: detach,
	parentNode: (node) => node.parent,
	nextSibling: (node) => {
		const siblings = node.parent?.children ?? []
		return siblings[siblings.indexOf(node) + 1] ?? null
	},
	patchProp: (node, key, _previous, next: MountValue) => {
		node.props[key] = next
	},
})

function mountText(node: MountNode): string {
	if (node.tag === undefined) return node.text ?? ''
	const attributes = Object.entries(node.props)
		.filter(([, value]) => !isPropHandler(value))
		.map(
			([key, value]) =>
				` ${key}="${isText(value) ? value : JSON.stringify(value)}"`,
		)
		.join('')
	return `<${node.tag}${attributes}>${node.children.map(mountText).join('')}</${node.tag}>`
}

function findNode(
	node: MountNode,
	match: (props: MountProps) => boolean,
): MountNode | undefined {
	if (node.tag !== undefined && match(node.props)) return node
	for (const child of node.children) {
		const found = findNode(child, match)
		if (found) return found
	}
	return undefined
}

/** A component mounted in a browser, as a client navigation shows it. */
export interface BrowserMount {
	/**
	 * Settles once the page's suspense resolved: when a client navigation
	 * would show the component.
	 */
	shown: Promise<void>
	/** What the component shows now (`''` while the navigation waits). */
	text: () => string
	/**
	 * The props, handlers included, of the first element shown that `match`
	 * accepts: what a click or a toggle on it would call.
	 */
	find: (match: (props: MountProps) => boolean) => MountProps | undefined
	reads: BackendRead[]
	/** What the mounted components threw outside a test's own calls. */
	errors: unknown[]
}

/** What a browser mount adds to the app around the component. */
export interface BrowserMountOptions {
	/** Values the app provides, as an installed module does for the whole app. */
	provide?: [symbol, unknown][]
	/** Components registered over the stubs, by name. */
	components?: Record<string, Component>
}

/**
 * Mounts `component` in a browser's app (no server render to hydrate) inside
 * the `<Suspense>` a page navigation renders in, answering each backend
 * request with `respond`, which may answer later (a promise).
 */
export function browserMount(
	component: Component,
	respond: Backend,
	props: Record<string, MountValue> = {},
	options: BrowserMountOptions = {},
): BrowserMount {
	backend = respond
	reads.length = 0
	confirmations.length = 0
	drawers.length = 0
	const runtime = engine.createDmsFrontendRuntime(undefined, {}, false)
	let resolveShown!: () => void
	const shown = new Promise<void>((resolve) => (resolveShown = resolve))
	const app = createMountApp({
		render: () =>
			h(
				vue.Suspense,
				{ onResolve: () => resolveShown() },
				{ default: () => h(component, props) },
			),
	})
	engine.provideDmsFrontendRuntime(app, runtime)
	app.provide(vue.ssrContextKey, {})
	app.component('DmsClientOnly', engine.DmsClientOnly)
	const replacements = options.components ?? {}
	for (const name of UI_COMPONENTS)
		if (!Object.hasOwn(replacements, name)) app.component(name, uiStub(name))
	for (const [name, replacement] of Object.entries(replacements))
		app.component(name, replacement)
	for (const [key, value] of options.provide ?? []) app.provide(key, value)
	app.config.warnHandler = noop
	const errors: unknown[] = []
	app.config.errorHandler = (error) => {
		errors.push(error)
	}
	const root = mountNode({ tag: 'root' })
	app.mount(root)
	return {
		shown,
		text: () => mountText(root),
		find: (match) => findNode(root, match)?.props,
		reads,
		errors,
	}
}

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
	props: Record<string, MountValue> = {},
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
	const value = app.runWithContext(() => scope.run(setup))
	if (value === undefined) throw new Error('the effect scope is inactive')
	return { value, reads }
}

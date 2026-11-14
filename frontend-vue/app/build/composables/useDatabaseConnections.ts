import { reloadForSelection } from './reloadForSelection'

/** A part of the console an external database cannot serve. */
export type ConnectionFeature =
	| 'diagram'
	| 'queryConsole'
	| 'instances'
	| 'rowReferences'
	| 'schemaEdits'
	| 'migrations'
	| 'indexes'

export type ConnectionAccess = 'read' | 'read-write'

export interface DatabaseConnection {
	id: string
	kind: 'own' | 'external'
	label: string
	engine: string | null
	access: ConnectionAccess
	/** Null when the catalog could not tell whether the account may write. */
	canWrite: boolean | null
	unsupported: ConnectionFeature[]
}

export interface ConnectionsState {
	/** The connection this user browses: every page of the module follows it. */
	selected: string
	accessEditable: boolean
	connections: DatabaseConnection[]
}

export const OWN_CONNECTION = 'own'

const CONNECTIONS_ENDPOINT = '/api/database/connections'
const EMPTY_STATE: ConnectionsState = {
	selected: OWN_CONNECTION,
	accessEditable: false,
	connections: [],
}

/** Whether the connection is one the console reaches through the catalog. */
export function isExternal(
	connection: DatabaseConnection | undefined,
): connection is DatabaseConnection {
	return connection?.kind === 'external'
}

/** Whether the connection lists the feature as one it cannot serve. */
export function lacksFeature(
	connection: DatabaseConnection | undefined,
	feature: ConnectionFeature,
): boolean {
	return connection?.unsupported.includes(feature) ?? false
}

/** Whether the connection refuses edits: an external one left on read. */
export function refusesEdits(
	connection: DatabaseConnection | undefined,
): boolean {
	return isExternal(connection) && connection.access === 'read'
}

export function useDatabaseConnections() {
	const read = useApiData<ConnectionsState>(CONNECTIONS_ENDPOINT, {
		default: () => EMPTY_STATE,
	})
	const { $authFetch } = useAuthFetch()
	const { presentError } = useApiErrorPresenter()

	const state = computed(() => read.data.value ?? EMPTY_STATE)
	const connections = computed(() => state.value.connections)
	const selected = computed(() =>
		connections.value.find(
			(connection) => connection.id === state.value.selected,
		),
	)

	const failed = computed(() => read.status.value === 'error')

	async function write(
		path: string,
		body: object,
		fallbackKey: string,
		keepsSelection: boolean,
	): Promise<boolean> {
		try {
			const next = await $authFetch<ConnectionsState>(
				`${CONNECTIONS_ENDPOINT}/${path}`,
				{ method: 'PUT', body },
			)
			if (keepsSelection && next.selected !== state.value.selected) {
				reloadForSelection()
				return false
			}
			read.data.value = next
			return true
		} catch (error) {
			presentError(error, { fallbackKey })
			return false
		}
	}

	let rechecking: Promise<void> | null = null

	return {
		connections,
		selected,
		accessEditable: computed(() => state.value.accessEditable),
		external: computed(() => isExternal(selected.value)),
		refusesEdits: computed(() => failed.value || refusesEdits(selected.value)),
		lacks: (feature: ConnectionFeature) =>
			lacksFeature(selected.value, feature),
		/** Whether the connections could not be read: no database is known, so no edit is safe. */
		failed,
		/**
		 * Stores the connection this user browses; true once the server took
		 * it, and every API of the module answers for it from then on.
		 */
		select: (id: string) =>
			write(
				'selected',
				{ connection: id },
				'dms_database.connections.switcher.failed',
				false,
			),
		/**
		 * Allows or refuses the edits of an external connection. Reloads the
		 * page instead when the server's selection is no longer the one this
		 * page loaded with.
		 */
		setAccess: (id: string, access: ConnectionAccess) =>
			write(
				`${encodeURIComponent(id)}/access`,
				{ access },
				'dms_database.connections.access.failed',
				true,
			),
		/**
		 * Reads the connections again, apart from the page's state, and
		 * reloads the page when the server's selection is no longer the one
		 * it loaded with (another tab switched), or when the first read failed
		 * and this one answered. A failed read changes nothing.
		 */
		recheck: (): Promise<void> => {
			rechecking ??= $authFetch<ConnectionsState>(CONNECTIONS_ENDPOINT)
				.then((next) => {
					if (failed.value || next.selected !== state.value.selected)
						reloadForSelection()
				})
				.catch(() => undefined)
				.finally(() => {
					rechecking = null
				})
			return rechecking
		},
		/**
		 * Settles once the first read is in, at once when the connections were
		 * read before: a page awaiting it does not fetch for a selection it
		 * does not know yet.
		 */
		ready: read.then(() => undefined),
	}
}

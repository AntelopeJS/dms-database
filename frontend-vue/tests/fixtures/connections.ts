import type {
	ConnectionsState,
	DatabaseConnection,
} from '../../app/build/composables/useDatabaseConnections'
import type { BackendRead } from './serverRender'

export const CONNECTIONS_URL = '/api/database/connections'

/** The project database as the API names it: by a label the console never shows. */
export const OWN: DatabaseConnection = {
	id: 'own',
	kind: 'own',
	label: 'legacy-label',
	engine: 'mongodb',
	access: 'read-write',
	canWrite: true,
	unsupported: [],
}

/** A customer's Postgres, read only, that its account may write to. */
export const WAREHOUSE: DatabaseConnection = {
	id: 'warehouse',
	kind: 'external',
	label: 'Warehouse',
	engine: 'postgres',
	access: 'read',
	canWrite: true,
	unsupported: ['diagram', 'queryConsole', 'instances', 'rowReferences'],
}

/** The state the API answers while `selected` is browsed. */
export function connectionsState(
	selected: DatabaseConnection,
	overrides: Partial<ConnectionsState> = {},
): ConnectionsState {
	return {
		selected: selected.id,
		accessEditable: true,
		connections: [OWN, WAREHOUSE].map((connection) =>
			connection.id === selected.id ? selected : connection,
		),
		...overrides,
	}
}

/**
 * A backend that answers the connections read with `state`, every write to
 * it with what `answer` makes of the request (the state by default), and
 * everything else with `others`.
 */
export function connectionsBackend(
	state: ConnectionsState,
	options: {
		answer?: (write: BackendRead) => unknown
		others?: (read: BackendRead) => unknown
	} = {},
): (read: BackendRead) => unknown {
	return (read) => {
		if (read.url === CONNECTIONS_URL) return state
		if (read.url.startsWith(`${CONNECTIONS_URL}/`) && read.method === 'PUT')
			return options.answer ? options.answer(read) : state
		return options.others ? options.others(read) : {}
	}
}

/** The writes a mount made to the connections API, as method, URL and body. */
export function connectionWrites(
	reads: BackendRead[],
): { method: string; url: string; body: unknown }[] {
	return reads
		.filter((read) => read.method !== 'GET')
		.map(({ method, url, body }) => ({ method, url, body }))
}

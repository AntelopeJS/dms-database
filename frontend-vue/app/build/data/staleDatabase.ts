const STALE_MESSAGE =
	'The selected database changed in another tab: reload the page'
const STALE_KEY = 'dms_database.data.save.database_changed'
const CONFLICT = 409

function read(value: unknown, key: string): unknown {
	return typeof value === 'object' && value !== null
		? Reflect.get(value, key)
		: undefined
}

/** The edit route's refusal of a write sent from a page whose database is no longer the selected one, as the error API presents it. */
export class StaleDatabaseError extends Error {
	readonly statusCode = CONFLICT
	readonly data = { message: STALE_KEY, severity: 'warning' }

	constructor(readonly response: unknown) {
		super(STALE_KEY)
	}
}

/**
 * Turns the edit route's stale-database refusal, whose body the API sends as
 * text, into one the error API translates; any other error comes back as it is.
 */
export function presentableWriteError(error: unknown): unknown {
	const response = read(error, 'response')
	const status =
		read(error, 'statusCode') ??
		read(error, 'status') ??
		read(response, 'status')
	const body = read(error, 'data') ?? read(response, '_data')
	const message = typeof body === 'string' ? body : read(body, 'message')
	return status === CONFLICT && message === STALE_MESSAGE
		? new StaleDatabaseError(response)
		: error
}

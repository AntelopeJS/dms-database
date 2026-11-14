const STALE_MESSAGE =
	'The selected database changed in another tab: reload the page'
const STALE_KEY = 'dms_database.data.save.database_changed'
const CONFLICT = 409
const READ_ONLY_MESSAGE = /^Access to (.+) is read only$/
const READ_ONLY_KEY = 'dms_database.data.save.read_only_access'
const FORBIDDEN = 403

function read(value: unknown, key: string): unknown {
	return typeof value === 'object' && value !== null
		? Reflect.get(value, key)
		: undefined
}

/** A refusal of the edit route, as the error API presents it: a translated key with its parameters. */
export class PresentableWriteError extends Error {
	readonly data: {
		message: string
		params: Record<string, string>
		severity: 'warning'
	}

	constructor(
		readonly statusCode: number,
		readonly response: unknown,
		key: string,
		params: Record<string, string> = {},
	) {
		super(key)
		this.data = { message: key, params, severity: 'warning' }
	}
}

/**
 * Turns the edit route's refusals whose body the API sends as text (a write
 * from a stale tab, a write to a connection whose access is read only) into
 * ones the error API translates; any other error comes back as it is.
 */
export function presentableWriteError(error: unknown): unknown {
	const response = read(error, 'response')
	const status =
		read(error, 'statusCode') ??
		read(error, 'status') ??
		read(response, 'status')
	const body = read(error, 'data') ?? read(response, '_data')
	const message = typeof body === 'string' ? body : read(body, 'message')
	if (status === CONFLICT && message === STALE_MESSAGE)
		return new PresentableWriteError(CONFLICT, response, STALE_KEY)
	const readOnly =
		status === FORBIDDEN && typeof message === 'string'
			? READ_ONLY_MESSAGE.exec(message)
			: null
	return readOnly?.[1] === undefined
		? error
		: new PresentableWriteError(FORBIDDEN, response, READ_ONLY_KEY, {
				connection: readOnly[1],
			})
}

import { isNumber, isRecord, isText } from '../utils/values'

function bodyFailure(data: unknown) {
	if (isText(data)) return data ? { message: data, durationMs: null } : null
	if (isRecord(data)) {
		const { message, durationMs } = data
		if (isText(message) && message)
			return { message, durationMs: isNumber(durationMs) ? durationMs : null }
	}
	return null
}

/** The query routes' 400 diagnostics stay inline instead of becoming toasts. */
export function sqlFailure(error: unknown) {
	if (isRecord(error)) {
		if (error.statusCode === 400) return bodyFailure(error.data)
	}
	return null
}

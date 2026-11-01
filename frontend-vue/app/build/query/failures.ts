/** The query routes' 400 diagnostics stay inline instead of becoming toasts. */
export function sqlFailure(error: unknown) {
	if (typeof error !== 'object' || error === null) return null
	const status = 'statusCode' in error ? error.statusCode : undefined
	if (status !== 400) return null
	const data = 'data' in error ? error.data : undefined
	if (typeof data === 'string' && data)
		return { message: data, durationMs: null }
	if (typeof data !== 'object' || data === null) return null
	const message = 'message' in data ? data.message : undefined
	if (typeof message !== 'string' || !message) return null
	const duration = 'durationMs' in data ? data.durationMs : undefined
	return {
		message,
		durationMs: typeof duration === 'number' ? duration : null,
	}
}

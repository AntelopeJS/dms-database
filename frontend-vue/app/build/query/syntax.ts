// Where a query text breaks, told in its own terms. The console evaluates the
// text inside a wrapper, so the engine's own SyntaxError points at the
// wrapper ("Unexpected token ';'") rather than at the missing parenthesis.

export type SyntaxProblem =
	| { kind: 'unclosed'; char: string; line: number; column: number }
	| {
			kind: 'unexpected'
			char: string
			expected?: string
			line: number
			column: number
	  }
	| { kind: 'string'; char: string; line: number; column: number }

const CLOSING: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const OPENING: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

function position(text: string, index: number) {
	const before = text.slice(0, index)
	const line = before.split('\n').length
	return { line, column: index - before.lastIndexOf('\n') }
}

/**
 * The first unbalanced bracket or unterminated string of a query text, with
 * its line and column (1-based); null when brackets and quotes balance.
 * Strings and comments are skipped; a template literal's `${…}` is not
 * looked into.
 */
export function findSyntaxProblem(text: string): SyntaxProblem | null {
	const stack: { char: string; index: number }[] = []
	let index = 0
	while (index < text.length) {
		const char = text[index] as string
		const next = text[index + 1]
		if (char === '/' && next === '/') {
			const end = text.indexOf('\n', index)
			index = end < 0 ? text.length : end
			continue
		}
		if (char === '/' && next === '*') {
			const end = text.indexOf('*/', index + 2)
			index = end < 0 ? text.length : end + 2
			continue
		}
		if (char === '"' || char === "'" || char === '`') {
			let cursor = index + 1
			while (cursor < text.length && text[cursor] !== char) {
				if (text[cursor] === '\\') cursor += 1
				// A plain string ends at its line.
				else if (text[cursor] === '\n' && char !== '`') break
				cursor += 1
			}
			if (cursor >= text.length || text[cursor] !== char)
				return { kind: 'string', char, ...position(text, index) }
			index = cursor + 1
			continue
		}
		if (CLOSING[char]) stack.push({ char, index })
		else if (OPENING[char]) {
			const open = stack.pop()
			if (!open || open.char !== OPENING[char])
				return {
					kind: 'unexpected',
					char,
					expected: open ? CLOSING[open.char] : undefined,
					...position(text, index),
				}
		}
		index += 1
	}
	const unclosed = stack.at(-1)
	return unclosed
		? {
				kind: 'unclosed',
				char: unclosed.char,
				...position(text, unclosed.index),
			}
		: null
}

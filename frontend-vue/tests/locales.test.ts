import { baseCompile } from '@intlify/message-compiler'
import { describe, expect, it } from 'vitest'

// vue-i18n compiles a message the first time it shows it: a stray `@`, `{`,
// `}` or `|` then fails at runtime, on the page that shows it (S-1). Compile
// every message of every locale here instead; literals go through `{'@'}`.

type Messages = { [key: string]: string | Messages }

const locales = import.meta.glob<Messages>('../i18n/locales/*.json', {
	eager: true,
	import: 'default',
})

function leaves(messages: Messages, prefix = ''): [string, string][] {
	return Object.entries(messages).flatMap(([key, value]) => {
		const path = prefix ? `${prefix}.${key}` : key
		return typeof value === 'string' ? [[path, value]] : leaves(value, path)
	})
}

function compileErrors(message: string): string[] {
	const errors: string[] = []
	baseCompile(message, {
		onError: (error) => errors.push(error.message),
		onWarn: () => undefined,
	})
	return errors
}

describe('locale messages', () => {
	it('finds the locale files', () => {
		expect(Object.keys(locales).length).toBeGreaterThan(0)
	})

	it.each(Object.entries(locales))(
		'compiles every message of %s',
		(_file, messages) => {
			const failures = leaves(messages)
				.map(([key, message]) => ({ key, errors: compileErrors(message) }))
				.filter((entry) => entry.errors.length > 0)
				.map((entry) => `${entry.key}: ${entry.errors.join(', ')}`)
			expect(failures).toEqual([])
		},
	)

	it('reports an unescaped linked-message sign', () => {
		expect(compileErrors('declares tables with @RegisterTable.')).not.toEqual(
			[],
		)
		expect(compileErrors("declares tables with {'@'}RegisterTable.")).toEqual(
			[],
		)
	})
})

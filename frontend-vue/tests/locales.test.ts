import { baseCompile } from '@intlify/message-compiler'
import { describe, expect, it } from 'vitest'

type Messages = { [key: string]: string | Messages }

const locales = import.meta.glob<Messages>('../i18n/locales/*.json', {
	eager: true,
	import: 'default',
})

function isMessage(value: string | Messages): value is string {
	return typeof value === 'string'
}

function leaves(messages: Messages, prefix = ''): [string, string][] {
	return Object.entries(messages).flatMap(([key, value]) => {
		const path = prefix ? `${prefix}.${key}` : key
		return isMessage(value) ? [[path, value]] : leaves(value, path)
	})
}

function compileErrors(message: string): string[] {
	const errors: string[] = []
	baseCompile(message, {
		onError: (error) => errors.push(error.message),
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

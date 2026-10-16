import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { baseCompile } from '@intlify/message-compiler'
import { describe, expect, it } from 'vitest'

// vue-i18n compiles a message the first time it shows it: a stray `@`, `{`,
// `}` or `|` then fails at runtime, on the page that shows it (S-1). Compile
// every message of every locale here instead; literals go through `{'@'}`.

const LOCALES_DIR = join(import.meta.dirname, '../i18n/locales')

type Messages = { [key: string]: string | Messages }

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

const files = readdirSync(LOCALES_DIR).filter((file) => file.endsWith('.json'))

describe('locale messages', () => {
	it('finds the locale files', () => {
		expect(files.length).toBeGreaterThan(0)
	})

	it.each(files)('compiles every message of %s', (file) => {
		const messages = JSON.parse(
			readFileSync(join(LOCALES_DIR, file), 'utf8'),
		) as Messages
		const failures = leaves(messages)
			.map(([key, message]) => ({ key, errors: compileErrors(message) }))
			.filter((entry) => entry.errors.length > 0)
			.map((entry) => `${entry.key}: ${entry.errors.join(', ')}`)
		expect(failures).toEqual([])
	})

	it('reports an unescaped linked-message sign', () => {
		expect(compileErrors('declares tables with @RegisterTable.')).not.toEqual(
			[],
		)
		expect(compileErrors("declares tables with {'@'}RegisterTable.")).toEqual(
			[],
		)
	})
})

// `<i18n-t>` looks for its component's own messages first; the module's
// components have none, and vue-i18n warns on each page that renders one
// ("Not found parent scope"). The module's messages are global: say so.
const COMPONENTS_DIR = join(import.meta.dirname, '../app')

function vueFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) return vueFiles(path)
		return entry.name.endsWith('.vue') ? [path] : []
	})
}

describe('translated templates', () => {
	it('reads every <i18n-t> from the global messages', () => {
		const unscoped = vueFiles(COMPONENTS_DIR).flatMap((file) =>
			(readFileSync(file, 'utf8').match(/<i18n-t\b[^>]*>/g) ?? [])
				.filter((tag) => !/\sscope="global"/.test(tag))
				.map((tag) => `${file.slice(COMPONENTS_DIR.length)}: ${tag}`),
		)
		expect(unscoped).toEqual([])
	})
})

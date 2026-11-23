import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { normalizePath } from 'vite'
import { defineConfig } from 'vitest/config'
import { backendBoundary } from './build/backend-boundary.ts'

/**
 * The renderer and the DMS core layer the server-render tests run on: the
 * ones the repository installs at its root (`@antelopejs/dms-frontend`,
 * `@antelopejs/dms`), as `pnpm test:frontend` builds against them.
 */
const root = resolve(__dirname, '..', 'node_modules', '@antelopejs')

/** Matches one test file wherever the checkout lives, dot directories included. */
const testFile = (name: string) =>
	normalizePath(resolve(__dirname, 'tests', name)).replace(
		/[*?[\]{}()!+@|]/g,
		'\\$&',
	)

export default defineConfig({
	plugins: [vue(), backendBoundary()],
	resolve: {
		alias: {
			'#dms/frontend-module': resolve(
				root,
				'dms-frontend/templates/vue/frontend-module.ts',
			),
			'#dms-core': resolve(root, 'dms/frontend-vue/layers/dms-core'),
			'#dms-ui': resolve(root, 'dms/frontend-vue/layers/dms-ui'),
			vue: resolve(__dirname, 'node_modules/vue'),
			'@unhead/vue': resolve(__dirname, 'node_modules/@unhead/vue'),
			'@inertiajs/vue3': resolve(__dirname, 'tests/fixtures/inertia.ts'),
			'vue-i18n': resolve(__dirname, 'tests/fixtures/vueI18n.ts'),
		},
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		testTransformMode: {
			web: [
				testFile('clientNavigation.test.ts'),
				testFile('apiErrorPresentation.test.ts'),
				testFile('connectionStatus.test.ts'),
				testFile('databaseSwitcher.test.ts'),
				testFile('accessBar.test.ts'),
				testFile('lockedPages.test.ts'),
				testFile('externalBrowser.test.ts'),
				testFile('editRequest.test.ts'),
			],
		},
	},
})

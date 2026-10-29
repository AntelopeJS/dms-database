import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import { backendBoundary } from './build/backend-boundary.ts'

// The renderer and the DMS core layer the server-render tests run on: the
// ones the repository installs at its root (`@antelopejs/dms-frontend`,
// `@antelopejs/dms`), as `pnpm test:frontend` builds against them.
const root = resolve(__dirname, '..', 'node_modules', '@antelopejs')

export default defineConfig({
	plugins: [vue(), backendBoundary()],
	resolve: {
		alias: {
			'#dms/frontend-module': resolve(
				root,
				'dms-frontend/templates/vue/frontend-module.ts',
			),
			'#dms-core': resolve(root, 'dms/frontend-vue/layers/dms-core'),
			// The renderer's own imports, from this package's dependencies: one
			// Vue for the renderer and the components.
			vue: resolve(__dirname, 'node_modules/vue'),
			'@unhead/vue': resolve(__dirname, 'node_modules/@unhead/vue'),
			// What the renderer reads of Inertia and vue-i18n in the browser only.
			'@inertiajs/vue3': resolve(__dirname, 'tests/fixtures/inertia.ts'),
			'vue-i18n': resolve(__dirname, 'tests/fixtures/vueI18n.ts'),
		},
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		// Still Node, but the components compiled for a browser (a client
		// `render`, not the server's `ssrRender`): what a client navigation
		// mounts.
		testTransformMode: { web: ['**/clientNavigation.test.ts'] },
	},
})

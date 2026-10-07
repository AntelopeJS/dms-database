import { defineDmsFrontendBuild } from '#dms/frontend-build'

// The layer's composables and helpers are used across its components without
// an import, so they are declared here: dms-frontend 0.4 auto-imports nothing
// a module does not list.
export default defineDmsFrontendBuild((build) => {
	build.registerAutoImports(['app/composables', 'app/utils'])
})

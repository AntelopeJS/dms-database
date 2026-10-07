import { defineAsyncComponent, type Component } from 'vue'
import type { DmsFrontendModule } from '#dms/frontend-module'

interface VueModule {
	default: Component
}

// Every component is addressed by name from the backend (`CustomComponent`,
// drawer targets), so the whole directory is registered: `DataBrowser.vue`
// resolves as `DmsDatabaseDataBrowser`.
const components = import.meta.glob<VueModule>('./app/components/**/*.vue')

const frontendModule: DmsFrontendModule = {
	componentPrefix: 'DmsDatabase',
	setup(sdk) {
		for (const [path, loader] of Object.entries(components).sort()) {
			const name = path
				.split('/')
				.at(-1)!
				.replace(/\.vue$/, '')
			sdk.registerComponent(
				name,
				defineAsyncComponent(async () => (await loader()).default),
			)
		}
	},
}

export default frontendModule

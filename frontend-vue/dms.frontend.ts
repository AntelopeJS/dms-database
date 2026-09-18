import { defineAsyncComponent, type Component } from 'vue'
import type { DmsFrontendModule } from '#dms/frontend-module'

interface VueModule {
	default: Component
}

const components = import.meta.glob<VueModule>('./app/components/**/*.vue')
const pages = import.meta.glob<VueModule>('./app/custom-pages/**/*.vue')

const frontendModule: DmsFrontendModule = {
	setup(sdk) {
		for (const [path, loader] of Object.entries(components).sort()) {
			const name = path
				.split('/')
				.at(-1)!
				.replace(/\.vue$/, '')
			sdk.registerComponent(
				`DmsDatabase${name}`,
				defineAsyncComponent(async () => (await loader()).default),
			)
		}
		for (const [path, loader] of Object.entries(pages).sort()) {
			const name = path.replace('./app/custom-pages/', '').replace(/\.vue$/, '')
			const component = defineAsyncComponent(
				async () => (await loader()).default,
			)
			const componentName = name
				.split('/')
				.map((part) => part[0].toUpperCase() + part.slice(1))
				.join('')
			sdk.registerPage(name, component, loader)
			sdk.registerComponent(`Dms${componentName}`, component)
		}
	},
}

export default frontendModule

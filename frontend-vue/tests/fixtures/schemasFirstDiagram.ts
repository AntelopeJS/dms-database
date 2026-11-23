import { defineComponent, h } from 'vue'
import SchemaDiagram from '../../app/components/SchemaDiagram.vue'

/** The diagram, rendered once the schemas read is in. */
export const SchemasFirstDiagram = defineComponent({
	async setup() {
		await useApiData('/api/database/schemas')
		return () => h(SchemaDiagram)
	},
})

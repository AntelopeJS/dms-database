import { defineComponent, h } from 'vue'
import { useDatabaseConnections } from '../../app/build/composables/useDatabaseConnections'
import DatabaseSwitcher from '../../app/components/DatabaseSwitcher.vue'

/** The database switcher, rendered once the connections read is in. */
export const ConnectionsFirstSwitcher = defineComponent({
	async setup() {
		await useDatabaseConnections().ready
		return () => h(DatabaseSwitcher)
	},
})

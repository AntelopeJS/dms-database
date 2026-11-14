<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import {
	OWN_CONNECTION,
	useDatabaseConnections,
	type DatabaseConnection,
} from '../build/composables/useDatabaseConnections'
import { confirmLeave } from '#dms-ui/app/entries/composables/unsaved-changes/registry'
import { forgetBrowserTabs } from '../build/composables/useDataBrowserTabs'
import { useLockedPages } from '../build/composables/useLockedPages'
import { useSelectionRecheck } from '../build/composables/useSelectionRecheck'
import { forgetRecentTables } from '../build/data/recentTables'
import {
	ONBOARDING_KEY,
	type PublicOnboarding,
} from '../build/data/assistantOnboarding'

defineProps<{ collapsed?: boolean }>()

const { t } = useI18n()
const route = useDmsRoute()
const { connections, selected, select, recheck } = useDatabaseConnections()
const onboarding = inject<PublicOnboarding | null>(ONBOARDING_KEY, null)
useLockedPages(selected)
useSelectionRecheck(recheck)

const switching = ref(false)

function nameOf(connection: DatabaseConnection): string {
	return connection.id === OWN_CONNECTION
		? t('dms_database.connections.own')
		: connection.label
}

const selectedName = computed(() =>
	selected.value ? nameOf(selected.value) : '',
)

async function pick(id: string) {
	if (switching.value || id === selected.value?.id) return
	switching.value = true
	if (!(await confirmLeave()) || !(await select(id))) {
		switching.value = false
		return
	}
	forgetBrowserTabs()
	forgetRecentTables()
	window.location.assign(route.path)
}

const items = computed<DropdownMenuItem[][]>(() => {
	const databases: DropdownMenuItem[] = connections.value.map((connection) => ({
		label: nameOf(connection),
		description: connection.engine ?? undefined,
		type: 'checkbox',
		checked: connection.id === selected.value?.id,
		icon: connection.kind === 'own' ? 'i-ph-database' : 'i-ph-plugs-connected',
		external: connection.kind === 'external',
		onSelect: () => void pick(connection.id),
	}))
	if (onboarding?.isAvailable !== true) return [databases]
	return [
		databases,
		[
			{
				label: t('dms_database.connections.switcher.connect'),
				icon: 'i-ph-plus',
				onSelect: () => onboarding.open('connect-database'),
			},
		],
	]
})
</script>

<template>
	<div v-if="connections.length > 0" class="px-2 pb-2" data-database-switcher>
		<UDropdownMenu
			:items="items"
			:content="{ align: 'start' }"
			:ui="{ content: 'min-w-56' }"
		>
			<UButton
				color="neutral"
				variant="outline"
				:block="!collapsed"
				:icon="
					selected?.kind === 'external'
						? 'i-ph-plugs-connected'
						: 'i-ph-database'
				"
				:trailing-icon="collapsed ? undefined : 'i-ph-caret-up-down'"
				:label="collapsed ? undefined : selectedName"
				:loading="switching"
				:aria-label="`${t('dms_database.connections.switcher.label')}: ${selectedName}`"
			/>
			<template #item-trailing="{ item }">
				<UBadge v-if="item.external" color="primary" variant="subtle" size="sm">
					{{ t('dms_database.connections.external') }}
				</UBadge>
			</template>
		</UDropdownMenu>
	</div>
</template>

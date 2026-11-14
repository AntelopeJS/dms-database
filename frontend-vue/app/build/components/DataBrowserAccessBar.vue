<script setup lang="ts">
import { useDatabaseConnections } from '../composables/useDatabaseConnections'

const { t } = useI18n()
const { confirm } = useConfirm()
const { selected, external, accessEditable, setAccess } =
	useDatabaseConnections()

const saving = ref(false)
const name = computed(() => selected.value?.label ?? '')
const readWrite = computed(() => selected.value?.access === 'read-write')
const canWrite = computed(() => selected.value?.canWrite)
const cannotAllowWrites = computed(
	() => !readWrite.value && canWrite.value !== true,
)

async function toggle(allowed: boolean) {
	const connection = selected.value
	if (!connection || saving.value) return
	if (
		allowed &&
		!(await confirm({
			title: t('dms_database.connections.access.confirm.title', {
				name: connection.label,
			}),
			description: t('dms_database.connections.access.confirm.description', {
				name: connection.label,
			}),
			confirmLabel: t('dms_database.connections.access.confirm.action'),
			cancelLabel: t('dms_database.connections.access.confirm.cancel'),
			color: 'warning',
			icon: 'i-ph-warning',
		}))
	)
		return
	saving.value = true
	await setAccess(connection.id, allowed ? 'read-write' : 'read')
	saving.value = false
}
</script>

<template>
	<div
		v-if="external"
		class="border-default bg-elevated flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2 text-sm"
		data-access-bar
	>
		<UIcon
			:name="readWrite ? 'i-ph-pencil-simple' : 'i-ph-lock-simple'"
			class="text-muted size-4"
		/>
		<span class="text-highlighted font-medium" data-access-state>
			{{
				t(
					readWrite
						? 'dms_database.connections.access.read_write'
						: 'dms_database.connections.access.read',
					{ name },
				)
			}}
		</span>
		<template v-if="accessEditable">
			<span
				v-if="canWrite !== true"
				class="text-muted flex items-center gap-1.5 text-xs"
				data-access-account-read-only
			>
				<UIcon name="i-ph-lock" class="size-3.5" />
				{{
					t(
						canWrite === false
							? 'dms_database.connections.access.account_read_only'
							: 'dms_database.connections.access.account_unverified',
					)
				}}
			</span>
			<DmsSwitch
				class="ml-auto"
				:model-value="readWrite"
				:disabled="cannotAllowWrites || saving"
				:loading="saving"
				:aria-label="t('dms_database.connections.access.toggle', { name })"
				data-access-toggle
				@update:model-value="toggle"
			/>
		</template>
	</div>
</template>

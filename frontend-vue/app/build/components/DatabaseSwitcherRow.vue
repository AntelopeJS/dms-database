<script setup lang="ts">
import type { DatabaseOption } from '../data/databaseOptions'

defineProps<{
	option: DatabaseOption
	isSwitching: boolean
	isDisabled: boolean
}>()

const emit = defineEmits<{ select: [id: string] }>()

const KEYS = 'dms_database.connections'
const { t } = useI18n()
</script>

<template>
	<button
		type="button"
		class="hover:bg-elevated focus-visible:ring-primary flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
		:class="[
			option.current ? 'bg-primary/10' : 'bg-transparent',
			{ 'cursor-default': option.current || isDisabled },
		]"
		:data-database-option="option.id"
		:aria-current="option.current ? 'true' : undefined"
		:aria-busy="isSwitching || undefined"
		:disabled="option.unavailable !== null || (isDisabled && !isSwitching)"
		:title="option.unavailable ?? undefined"
		@click="emit('select', option.id)"
	>
		<span
			class="bg-elevated text-primary ring-default inline-flex size-[26px] shrink-0 items-center justify-center rounded-md ring-1"
			:role="option.external ? 'img' : undefined"
			:aria-label="option.external ? t(`${KEYS}.external`) : undefined"
			:aria-hidden="option.external ? undefined : 'true'"
		>
			<UIcon :name="option.icon" class="size-4" />
		</span>
		<span class="flex min-w-0 flex-1 flex-col">
			<span class="text-highlighted truncate font-medium">
				{{ option.name }}
			</span>
			<span class="text-muted truncate font-mono text-[11.5px]">
				{{ option.subtitle }}
			</span>
			<span v-if="option.unavailable" class="sr-only">
				{{ option.unavailable }}
			</span>
		</span>
		<UBadge
			v-if="option.badge"
			:label="option.badge.label"
			:color="option.badge.tone"
			variant="subtle"
			size="sm"
			class="shrink-0"
		/>
		<UIcon
			v-if="isSwitching"
			name="i-ph-spinner-gap"
			class="text-primary size-4 shrink-0 animate-spin"
			:aria-label="t(`${KEYS}.switcher.switching`)"
		/>
		<UIcon
			v-else-if="option.current"
			name="i-ph-check"
			class="text-primary size-4 shrink-0"
			:aria-label="t(`${KEYS}.switcher.current`)"
		/>
	</button>
</template>

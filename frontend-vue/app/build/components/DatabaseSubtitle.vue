<script setup lang="ts">
import type { DatabaseAccess } from '../data/databaseOptions'

defineProps<{ text: string; access: DatabaseAccess | null }>()
</script>

<template>
	<span class="flex min-w-0 items-center gap-1">
		<span class="min-w-0 truncate">{{ text }}</span>
		<template v-if="access">
			<span aria-hidden="true" class="shrink-0">·</span>
			<span class="inline-flex shrink-0 items-center gap-0.5">
				<UIcon :name="access.icon" class="size-3" />
				{{ access.label }}
			</span>
		</template>
	</span>
</template>

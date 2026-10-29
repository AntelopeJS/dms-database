<script setup lang="ts">
import { GRID_PAGE_SIZES } from '../composables/useDataBrowserGrid'

const PAGE_WINDOW = 2

const props = defineProps<{ total: number }>()
const current = defineModel<number>('page', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })

const { t, n } = useI18n()

const pageSizeOptions = GRID_PAGE_SIZES.map((size) => ({
	label: String(size),
	value: size,
}))
const pageCount = computed(() =>
	Math.max(1, Math.ceil(props.total / pageSize.value)),
)
const pageStart = computed(() =>
	props.total === 0 ? 0 : current.value * pageSize.value + 1,
)
const pageEnd = computed(() =>
	Math.min(props.total, (current.value + 1) * pageSize.value),
)
const pages = computed(() => {
	const last = pageCount.value - 1
	const around = new Set([0, last])
	for (
		let page = current.value - PAGE_WINDOW;
		page <= current.value + PAGE_WINDOW;
		page += 1
	) {
		if (page >= 0 && page <= last) around.add(page)
	}
	return [...around].sort((a, b) => a - b)
})

function setPageSize(size: number) {
	pageSize.value = size
	current.value = 0
}
</script>

<template>
	<footer
		class="border-default text-muted flex flex-wrap items-center gap-3 border-t px-3 py-1.5 text-xs"
	>
		<span class="tabular-nums">
			{{ t('dms_database.data.grid.rows', { count: n(total) }, total) }}
		</span>
		<span class="flex items-center gap-1.5">
			{{ t('dms_database.data.grid.page_size') }}
			<USelect
				:model-value="pageSize"
				:items="pageSizeOptions"
				size="xs"
				class="w-20"
				@update:model-value="setPageSize(Number($event))"
			/>
		</span>
		<span class="text-dimmed hidden items-center gap-1 2xl:flex">
			<UKbd value="enter" size="sm" />
			{{ t('dms_database.data.grid.kbd_edit') }}
			<UKbd value="esc" size="sm" class="ml-1.5" />
			{{ t('dms_database.data.grid.kbd_cancel') }}
			<UKbd value="space" size="sm" class="ml-1.5" />
			{{ t('dms_database.data.grid.kbd_open') }}
			<UKbd value="meta" size="sm" class="ml-1.5" />
			<UKbd value="s" size="sm" />
			{{ t('dms_database.data.grid.kbd_save') }}
		</span>
		<nav
			class="ml-auto flex items-center gap-1"
			:aria-label="t('dms_database.data.grid.pagination')"
		>
			<span class="mr-2 tabular-nums">{{ pageStart }}–{{ pageEnd }}</span>
			<UButton
				icon="i-ph-caret-left"
				color="neutral"
				variant="ghost"
				size="xs"
				:disabled="current === 0"
				:aria-label="t('dms_database.data.grid.previous_page')"
				@click="current -= 1"
			/>
			<template v-for="(page, index) in pages" :key="page">
				<span
					v-if="index > 0 && page - (pages[index - 1] ?? page) > 1"
					class="text-dimmed px-1"
				>
					…
				</span>
				<UButton
					size="xs"
					:color="page === current ? 'primary' : 'neutral'"
					:variant="page === current ? 'soft' : 'ghost'"
					:label="String(page + 1)"
					class="tabular-nums"
					@click="current = page"
				/>
			</template>
			<UButton
				icon="i-ph-caret-right"
				color="neutral"
				variant="ghost"
				size="xs"
				:disabled="pageEnd >= total"
				:aria-label="t('dms_database.data.grid.next_page')"
				@click="current += 1"
			/>
		</nav>
	</footer>
</template>

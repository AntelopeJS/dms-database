<script setup lang="ts" generic="Tab extends string">
import { useResizeObserver, useScroll } from '@vueuse/core'

// The tab list of a drawer: on a phone, or a drawer narrower than its tabs,
// it scrolls sideways, and a fade on the side more tabs hide in says so.

interface DrawerTab {
	value: Tab
	label: string
	badge?: number
}

defineProps<{ items: DrawerTab[] }>()
const active = defineModel<Tab>({ required: true })

const scroller = useTemplateRef('scroller')
const { arrivedState, measure } = useScroll(scroller)
const overflows = ref(false)

useResizeObserver(scroller, () => {
	const element = scroller.value
	overflows.value = Boolean(
		element && element.scrollWidth > element.clientWidth + 1,
	)
	measure()
})

// A 24px fade on each side the list still scrolls to.
const fade = computed(() => {
	if (!overflows.value) return undefined
	const start = arrivedState.left ? 'black' : 'transparent'
	const end = arrivedState.right ? 'black' : 'transparent'
	return {
		maskImage: `linear-gradient(to right, ${start}, black 24px, black calc(100% - 24px), ${end})`,
	}
})
</script>

<template>
	<div
		ref="scroller"
		data-drawer-tabs
		:data-overflows="overflows || undefined"
		class="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
		:style="fade"
	>
		<UTabs
			v-model="active"
			:items="items"
			variant="link"
			size="sm"
			:content="false"
			class="w-max min-w-full"
			:ui="{ trigger: 'shrink-0' }"
		/>
	</div>
</template>

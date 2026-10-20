import { useResizeObserver } from '@vueuse/core'
import type { ShallowRef } from 'vue'

/** The nearest ancestor that scrolls vertically: a drawer's body. */
export function scrollParent(element: HTMLElement): HTMLElement | null {
	for (let node = element.parentElement; node; node = node.parentElement) {
		const { overflowY } = getComputedStyle(node)
		if (overflowY === 'auto' || overflowY === 'scroll') return node
	}
	return null
}

/**
 * The height left to `element` from its top to the end of the scroll area
 * `area` (its bottom padding off), in the area's content: scrolling does not
 * change it.
 */
export function roomBelow(area: HTMLElement, element: HTMLElement): number {
	const areaEnd =
		area.getBoundingClientRect().top +
		area.clientTop +
		area.clientHeight -
		Number.parseFloat(getComputedStyle(area).paddingBottom)
	return Math.max(
		0,
		areaEnd - element.getBoundingClientRect().top - area.scrollTop,
	)
}

/**
 * A drawer body's height left to `panel`, followed as the drawer is resized:
 * as its `min-height`, a footer pushed to the panel's end (`mt-auto`) sits at
 * the drawer's end however short the content. `null` until measured.
 */
export function useDrawerRoom(panel: Readonly<ShallowRef<HTMLElement | null>>) {
	const room = ref<number | null>(null)
	const scroller = shallowRef<HTMLElement | null>(null)

	function measure() {
		if (panel.value && scroller.value)
			room.value = roomBelow(scroller.value, panel.value)
	}

	onMounted(() => {
		if (panel.value) scroller.value = scrollParent(panel.value)
		measure()
	})
	useResizeObserver(scroller, measure)

	return room
}

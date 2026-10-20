import { useResizeObserver } from '@vueuse/core'
import type { ShallowRef } from 'vue'
import { fillingLines } from '../utils/fillingLines'

// DmsInputCode's line height: its size is given in lines.
const CODE_LINE_PX = 19

interface FillingCodeLinesElements {
	/** The panel, as tall as the room left in its scroll area. */
	panel: Readonly<ShallowRef<HTMLElement | null>>
	/** What the panel shows above its footer, the editor included. */
	body: Readonly<ShallowRef<HTMLElement | null>>
	/** The code editor. */
	editor: Readonly<ShallowRef<HTMLElement | null>>
	/** The footer, pinned to the panel's end. */
	footer: Readonly<ShallowRef<HTMLElement | null>>
}

function scrollParent(element: HTMLElement): HTMLElement | null {
	for (let node = element.parentElement; node; node = node.parentElement) {
		const { overflowY } = getComputedStyle(node)
		if (overflowY === 'auto' || overflowY === 'scroll') return node
	}
	return null
}

/**
 * A panel holding a code editor that fills the height of its scroll area (a
 * drawer's body): `room` is the panel's height there, `lines` the editor's,
 * never fewer than `minLines`. Both follow the area's size (the drawer
 * resized, a phone turned) and the panel's content (an error shown). Before
 * the panel mounts, the editor shows `minLines`.
 */
export function useFillingCodeLines(
	elements: FillingCodeLinesElements,
	minLines: number,
) {
	const lines = ref(minLines)
	const room = ref<number | null>(null)
	const scroller = shallowRef<HTMLElement | null>(null)

	function measure() {
		const panel = elements.panel.value
		const body = elements.body.value
		const editor = elements.editor.value
		const footer = elements.footer.value
		const area = scroller.value
		if (!panel || !body || !editor || !footer || !area) return
		const areaStyle = getComputedStyle(area)
		const areaEnd =
			area.getBoundingClientRect().top +
			area.clientTop +
			area.clientHeight -
			Number.parseFloat(areaStyle.paddingBottom)
		const panelBox = panel.getBoundingClientRect()
		// In the scroll area's content: scrolling does not change it.
		room.value = Math.max(0, areaEnd - panelBox.top - area.scrollTop)
		const editorHeight = editor.getBoundingClientRect().height
		// The footer sits at the panel's end, past the room the body leaves.
		const footerHeight = panelBox.bottom - footer.getBoundingClientRect().top
		const gap = Number.parseFloat(getComputedStyle(panel).rowGap) || 0
		lines.value = fillingLines({
			room: room.value,
			used:
				body.getBoundingClientRect().height - editorHeight + gap + footerHeight,
			editor: editorHeight,
			lines: lines.value,
			lineHeight: CODE_LINE_PX,
			minLines,
		})
	}

	onMounted(() => {
		if (elements.panel.value)
			scroller.value = scrollParent(elements.panel.value)
		measure()
	})
	useResizeObserver(() => [scroller.value, elements.body.value], measure)

	return { lines, room }
}

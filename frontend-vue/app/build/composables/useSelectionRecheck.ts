import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Runs `recheck` each time the window regains focus or the page becomes
 * visible again, while the component is mounted: what another tab did to the
 * server's selection in the meantime shows then.
 */
export function useSelectionRecheck(recheck: () => Promise<void>): void {
	function onVisibility() {
		if (document.visibilityState === 'visible') void recheck()
	}
	function onFocus() {
		void recheck()
	}
	onMounted(() => {
		window.addEventListener('focus', onFocus)
		document.addEventListener('visibilitychange', onVisibility)
	})
	onBeforeUnmount(() => {
		window.removeEventListener('focus', onFocus)
		document.removeEventListener('visibilitychange', onVisibility)
	})
}

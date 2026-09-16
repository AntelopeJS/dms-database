// A read-only DmsTableView has no edit form, so a row (double-)click only
// broadcasts the `DmsComponent.TableView.RowClick` event on `window`
// (detail = { component, data: { row } }). This composable subscribes to it for a
// single table instance and invokes `onRow` with the clicked row.
const ROW_CLICK_EVENT = "DmsComponent.TableView.RowClick";

export function useTableViewRowClick<T = Record<string, unknown>>(
	componentId: string,
	onRow: (row: T) => void,
): void {
	function handle(event: Event) {
		const detail = (event as CustomEvent).detail as {
			component?: string;
			data?: { row?: T };
		};
		if (detail?.component !== componentId) return;
		const row = detail.data?.row;
		if (row) onRow(row);
	}
	onMounted(() => window.addEventListener(ROW_CLICK_EVENT, handle));
	onBeforeUnmount(() => window.removeEventListener(ROW_CLICK_EVENT, handle));
}

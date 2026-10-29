import type { VueFlowStore } from '@vue-flow/core'
import type { ComputedRef, Ref, ShallowRef, ShallowUnwrapRef } from 'vue'
import { NODE_WIDTH, tableNodeId } from '../diagram/graph'
import { boundsOf, fitZoom, startViewport } from '../diagram/packing'
import type { SchemaSummary } from './useDatabaseSchemas'

export const RESET_ZOOM = 1
// Room around the tables for the floating toolbars.
const FIT_PADDING = 0.25
// Below this zoom a table cannot be read: a diagram too large to fit at it
// starts there, on its top-left corner, clear of the toolbars.
const START_MIN_ZOOM = 0.4
const START_INSET = { x: 32, y: 80 }

/** What the view reads and writes of the diagram page. */
interface ViewContext {
	canvas: ShallowRef<ShallowUnwrapRef<VueFlowStore> | null>
	canvasWrapper: Readonly<ShallowRef<HTMLElement | null>>
	viewport: Ref<{ x: number; y: number; zoom: number }>
	selectedId: Ref<string | null>
	schema: ComputedRef<SchemaSummary | null>
	route: ReturnType<typeof useDmsRoute>
	router: ReturnType<typeof useDmsRouter>
	warn: (title: string) => void
}

/** Where the canvas looks: the first frame, a fit, a table centred. */
export function useDiagramView({
	canvas,
	canvasWrapper,
	viewport,
	selectedId,
	schema,
	route,
	router,
	warn,
}: ViewContext) {
	const { t } = useI18n()
	let fitPending = true

	/** The next measured nodes frame the diagram again. */
	function requestFit() {
		fitPending = true
	}

	// The nodes have been measured: the first fit, or the one a schema change or
	// a focus asks for, can frame them.
	function onNodesInitialized() {
		if (!fitPending) return
		fitPending = false
		if (!centerOnQueryTable()) startView()
	}

	function fitAll() {
		canvas.value?.fitView({ padding: FIT_PADDING, maxZoom: RESET_ZOOM })
	}

	// The whole diagram when it fits at a readable zoom; else its top-left
	// corner at that zoom, the minimap and "Fit view" giving the overview.
	function startView() {
		const flow = canvas.value
		const rect = canvasWrapper.value?.getBoundingClientRect()
		if (!flow || !rect?.width || !rect.height) return fitAll()
		const bounds = boundsOf(
			flow.getNodes.map((node) => ({
				x: node.position.x,
				y: node.position.y,
				width: node.dimensions.width,
				height: node.dimensions.height,
			})),
		)
		const view = startViewport(
			bounds,
			fitZoom(bounds, rect, FIT_PADDING),
			START_MIN_ZOOM,
			START_INSET,
		)
		if (view) flow.setViewport(view)
		else fitAll()
	}

	function centerOn(nodeId: string): boolean {
		const node = canvas.value?.findNode(nodeId)
		if (!node) return false
		selectedId.value = nodeId
		canvas.value?.setCenter(
			node.position.x + NODE_WIDTH / 2,
			node.position.y + 120,
			{
				zoom: Math.max(viewport.value.zoom, RESET_ZOOM),
				duration: 300,
			},
		)
		return true
	}

	// The table the URL names; one that does not exist is reported and dropped
	// from the URL (D-12).
	function centerOnQueryTable(): boolean {
		const table = route.query.table
		const asked = route.query.schema
		if (typeof table !== 'string' || !schema.value) return false
		if (typeof asked === 'string' && asked !== schema.value.id) return false
		if (!schema.value.tables.some((entry) => entry.name === table)) {
			warn(
				t('dms_database.diagram.not_found.table', {
					schema: schema.value.id,
					table,
				}),
			)
			router.replace({ query: { ...route.query, table: undefined } })
			return false
		}
		return centerOn(tableNodeId(schema.value.id, table))
	}

	return {
		RESET_ZOOM,
		fitAll,
		startView,
		centerOn,
		onNodesInitialized,
		requestFit,
	}
}

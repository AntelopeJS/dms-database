import type { DiagramPosition } from '../composables/useDiagramPersistence'

// Places blocks (a group of related tables laid out by dagre, or a table on
// its own) in rows, so a schema of many unrelated tables fills a canvas
// shaped like the screen instead of one long column.

export interface Size {
	width: number
	height: number
}

export interface Rect extends Size {
	x: number
	y: number
}

export interface Block extends Size {
	id: string
}

/** Room between two blocks, and between a block and a note. */
export const PACK_GAP = 64
// Width / height of a canvas whose size is not known: a wide screen.
export const DEFAULT_ASPECT = 16 / 9
const WIDTH_CANDIDATES = 48
// Packings this close in shape to the best one (as a log of the ratio) count
// as as good: the most compact of them wins.
const SHAPE_TOLERANCE = 0.1

export function overlaps(a: Rect, b: Rect, margin = 0): boolean {
	return (
		a.x < b.x + b.width + margin &&
		b.x < a.x + a.width + margin &&
		a.y < b.y + b.height + margin &&
		b.y < a.y + a.height + margin
	)
}

/** The smallest rectangle around `rects`; an empty one at 0, 0 for none. */
export function boundsOf(rects: Rect[]): Rect {
	if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 }
	const left = Math.min(...rects.map((r) => r.x))
	const top = Math.min(...rects.map((r) => r.y))
	const right = Math.max(...rects.map((r) => r.x + r.width))
	const bottom = Math.max(...rects.map((r) => r.y + r.height))
	return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * Moves `rect` right, past every obstacle it would cover, keeping its row.
 */
function clearOf(rect: Rect, obstacles: Rect[]): Rect {
	let placed = rect
	for (;;) {
		const hit = obstacles.find((o) => overlaps(placed, o, PACK_GAP))
		if (!hit) return placed
		placed = { ...placed, x: hit.x + hit.width + PACK_GAP }
	}
}

interface Column extends Size {
	blocks: Block[]
}

/**
 * The columns of a row: its tallest block first, on its own, as it sets the
 * row's height; then the others in order, each under the one before while
 * the column stays within the row's height and `stack`, so short tables can
 * fill the room beside a tall group instead of leaving it empty.
 */
function rowColumns(row: Block[], stack: number): Column[] {
	const tallest = row.reduce((a, b) => (b.height > a.height ? b : a))
	const limit = Math.min(tallest.height, stack)
	const columns: Column[] = [{ blocks: [tallest], ...sizeOf(tallest) }]
	let current: Column | null = null
	for (const block of row) {
		if (block === tallest) continue
		if (current && current.height + PACK_GAP + block.height <= limit) {
			current.blocks.push(block)
			current.height += PACK_GAP + block.height
			current.width = Math.max(current.width, block.width)
			continue
		}
		current = { blocks: [block], ...sizeOf(block) }
		columns.push(current)
	}
	return columns
}

function widthOf(columns: Column[]): number {
	return (
		columns.reduce((sum, c) => sum + c.width, 0) +
		PACK_GAP * (columns.length - 1)
	)
}

/**
 * Splits `blocks`, in their order, into rows at most `rowWidth` wide, with
 * columns stacked up to `stack` high.
 */
export function shelfRows(
	blocks: Block[],
	rowWidth: number,
	stack = Infinity,
): Block[][] {
	const rows: Block[][] = []
	let row: Block[] = []
	for (const block of blocks) {
		if (row.length && widthOf(rowColumns([...row, block], stack)) > rowWidth) {
			rows.push(row)
			row = []
		}
		row.push(block)
	}
	if (row.length) rows.push(row)
	return rows
}

/**
 * Shelf packing: rows from `shelfRows`, top to bottom, each laid out in its
 * columns; a column that would cover an obstacle moves right past it.
 */
function packRows(
	blocks: Block[],
	rowWidth: number,
	stack: number,
	obstacles: Rect[],
): Map<string, Rect> {
	const placed = new Map<string, Rect>()
	let y = 0
	for (const row of shelfRows(blocks, rowWidth, stack)) {
		let x = 0
		let bottom = y
		for (const column of rowColumns(row, stack)) {
			const spot = clearOf({ x, y, ...sizeOf(column) }, obstacles)
			let top = y
			for (const block of column.blocks) {
				placed.set(block.id, { x: spot.x, y: top, ...sizeOf(block) })
				top += block.height + PACK_GAP
			}
			x = spot.x + column.width + PACK_GAP
			bottom = Math.max(bottom, y + column.height)
		}
		y = bottom + PACK_GAP
	}
	return placed
}

function sizeOf(block: Size): Size {
	return { width: block.width, height: block.height }
}

/**
 * Where each block goes, its top-left corner from 0, 0: the packing closest
 * to `aspect` (width / height) among rows of several widths, short blocks
 * stacked or not; of the ones about as close, the most compact. The order of
 * `blocks` is kept from row to row, and no block covers any of `obstacles`.
 */
export function packBlocks(
	blocks: Block[],
	aspect: number = DEFAULT_ASPECT,
	obstacles: Rect[] = [],
): Map<string, DiagramPosition> {
	if (!blocks.length) return new Map()
	const widest = Math.max(...blocks.map((b) => b.width))
	const total = blocks.reduce((sum, b) => sum + b.width + PACK_GAP, 0)
	const area = blocks.reduce(
		(sum, b) => sum + (b.width + PACK_GAP) * (b.height + PACK_GAP),
		0,
	)
	const ideal = Math.max(widest, Math.sqrt(area * aspect))
	// Row widths around the ideal one, from the widest block to one row.
	const widths = new Set([widest, total])
	for (let i = 0; i < WIDTH_CANDIDATES; i++) {
		const width = ideal * (0.5 + (1.5 * i) / WIDTH_CANDIDATES)
		if (width >= widest && width <= total) widths.add(width)
	}
	const tries = [...widths].flatMap((width) =>
		[0, width / aspect, Infinity].map((stack) => {
			const placed = packRows(blocks, width, stack, obstacles)
			const bounds = boundsOf([...placed.values()])
			const shape = bounds.width / Math.max(bounds.height, 1) / aspect
			return {
				placed,
				score: Math.abs(Math.log(shape)),
				area: bounds.width * bounds.height,
			}
		}),
	)
	const closest = Math.min(...tries.map((t) => t.score))
	const best = tries
		.filter((t) => t.score <= closest + SHAPE_TOLERANCE)
		.reduce((a, b) => (b.area < a.area ? b : a))
	const positions = new Map<string, DiagramPosition>()
	for (const [id, rect] of best.placed)
		positions.set(id, { x: rect.x, y: rect.y })
	return positions
}

/**
 * Groups `ids` linked by `links`: each group lists its ids in the order of
 * `ids`, and the groups come in the order of their first id.
 */
export function linkedGroups(
	ids: string[],
	links: [string, string][],
): string[][] {
	const parent = new Map(ids.map((id) => [id, id]))
	const root = (id: string): string => {
		let current = id
		while (parent.get(current) !== current)
			current = parent.get(current) ?? current
		parent.set(id, current)
		return current
	}
	for (const [a, b] of links) {
		if (!parent.has(a) || !parent.has(b)) continue
		const ra = root(a)
		const rb = root(b)
		if (ra !== rb) parent.set(rb, ra)
	}
	const groups = new Map<string, string[]>()
	for (const id of ids) {
		const key = root(id)
		groups.set(key, [...(groups.get(key) ?? []), id])
	}
	return [...groups.values()]
}

/** What a table name starts with before `__` (`dms-core__users`), or ''. */
export function namePrefix(name: string): string {
	const at = name.indexOf('__')
	return at > 0 ? name.slice(0, at) : ''
}

/**
 * Isolated tables in the order they are placed: by name prefix, the tables
 * without one in their own group, then by name within a group.
 */
export function prefixOrder(names: string[]): string[] {
	return [...names].sort((a, b) => {
		const pa = namePrefix(a)
		const pb = namePrefix(b)
		if (pa !== pb) {
			// The tables without a prefix come after the prefixed groups.
			if (!pa) return 1
			if (!pb) return -1
			return pa.localeCompare(pb)
		}
		return a.localeCompare(b)
	})
}

/**
 * The zoom Vue Flow's `fitView` gives `bounds` in a canvas of `size` with
 * `padding` (a share of the canvas), before its own zoom limits.
 */
export function fitZoom(bounds: Size, size: Size, padding: number): number {
	const room = 1 + padding
	return Math.min(
		size.width / room / Math.max(bounds.width, 1),
		size.height / room / Math.max(bounds.height, 1),
	)
}

/**
 * The view that starts the diagram: the whole layout when it fits at
 * `minZoom` or closer, else `minZoom` framed on its top-left corner.
 * `fitZoom` is the zoom that fits it all.
 */
export function startViewport(
	bounds: Rect,
	fitZoom: number,
	minZoom: number,
	inset: { x: number; y: number },
): { x: number; y: number; zoom: number } | null {
	if (fitZoom >= minZoom) return null
	return {
		x: inset.x - bounds.x * minZoom,
		y: inset.y - bounds.y * minZoom,
		zoom: minZoom,
	}
}

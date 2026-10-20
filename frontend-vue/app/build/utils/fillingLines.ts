/** What a code editor is measured at, to fill the room left to it. */
export interface FillingLinesMeasure {
	/** Pixels the whole panel may take (to the end of its scroll area). */
	room: number
	/** Pixels the panel takes besides the editor (label, error, footer…). */
	used: number
	/** The editor's height, frame included, at `lines`. */
	editor: number
	/** The lines the editor shows now. */
	lines: number
	lineHeight: number
	minLines: number
}

/**
 * The lines a code editor shows to fill the room it is left, never fewer than
 * `minLines`: its frame (padding, status bar, borders) is what it measures
 * beyond its lines. An editor shorter than its lines (short code its minimum
 * does not hold open) gives no frame: the lines then only follow the room.
 */
export function fillingLines(measure: FillingLinesMeasure): number {
	const frame = Math.max(0, measure.editor - measure.lines * measure.lineHeight)
	const free = measure.room - measure.used - frame
	return Math.max(measure.minLines, Math.floor(free / measure.lineHeight))
}

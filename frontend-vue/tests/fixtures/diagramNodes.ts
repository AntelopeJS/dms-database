import type { DiagramNode, OpenTable } from '../../app/build/diagram/graph'

/** What a table node of the diagram holds, as far as the tests read it. */
export interface TableNodeView {
	columns: string[]
	highlighted: string[]
	dimmed: boolean
	expanded: boolean
	hiddenCount: number
}

function isString(value: unknown): value is string {
	return typeof value === 'string'
}

function isStrings(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(isString)
}

function isTableNodeView(data: unknown): data is TableNodeView {
	return (
		typeof data === 'object' &&
		data !== null &&
		'columns' in data &&
		isStrings(data.columns) &&
		'highlighted' in data &&
		isStrings(data.highlighted) &&
		'dimmed' in data &&
		typeof data.dimmed === 'boolean' &&
		'expanded' in data &&
		typeof data.expanded === 'boolean' &&
		'hiddenCount' in data &&
		typeof data.hiddenCount === 'number'
	)
}

/** The data of a table node, or a failure when the node is missing or is no table. */
export function tableView(node: DiagramNode | undefined): TableNodeView {
	if (!node || !isTableNodeView(node.data))
		throw new Error('expected a table node of the diagram')
	return node.data
}

/** Whether a stub's `onOpenSchema` is the function that opens a table. */
export function isOpenTable(value: unknown): value is OpenTable {
	return typeof value === 'function'
}

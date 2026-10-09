// Vue Flow drags every selected node along with the one under the pointer,
// and it lists them as soon as the drag starts. The diagram moves one node
// at a time: a press on a node lets go of every other selected node first,
// before Vue Flow makes that list.

/** The id of the canvas node a press on `target` lands on, if any. */
export function pressedNodeId(target: EventTarget | null): string | null {
	const element = target as Element | null
	if (!element || typeof element.closest !== 'function') return null
	return element.closest('.vue-flow__node')?.getAttribute('data-id') ?? null
}

/** The selected nodes to let go of when the node `pressedId` is grabbed. */
export function nodesToRelease<T extends { id: string }>(
	selected: readonly T[],
	pressedId: string,
): T[] {
	return selected.filter((node) => node.id !== pressedId)
}

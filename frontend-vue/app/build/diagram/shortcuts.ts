// The diagram's keyboard shortcuts, the ones its toolbar's tooltips name.
// Letters match whatever their case (Caps Lock, Shift); undo and redo take
// Ctrl or ⌘, with Shift+Z or Y for redo.

export type DiagramCommand =
	| 'search'
	| 'note'
	| 'select'
	| 'pan'
	| 'fit'
	| 'resetZoom'
	| 'undo'
	| 'redo'
	| 'escape'

type KeyInput = Pick<
	KeyboardEvent,
	'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>

const PLAIN_KEYS: Record<string, DiagramCommand> = {
	f: 'search',
	n: 'note',
	v: 'select',
	h: 'pan',
	'1': 'fit',
	'0': 'resetZoom',
	escape: 'escape',
}

export function diagramCommand(event: KeyInput): DiagramCommand | null {
	if (event.altKey) return null
	const key = event.key.toLowerCase()
	if (event.ctrlKey || event.metaKey) {
		if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
		if (key === 'y' && !event.shiftKey) return 'redo'
		return null
	}
	return PLAIN_KEYS[key] ?? null
}

const EDITABLE =
	'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

/**
 * Whether a key pressed on `target` is the canvas's to handle: not while
 * typing, not while a dialog such as the inspector's drawer is open, and not
 * from an element outside the canvas that has the focus.
 */
export function canvasOwnsKey(
	target: EventTarget | null,
	canvas: Element | null,
): boolean {
	const element = target as Element | null
	if (!element || typeof element.closest !== 'function') return true
	if (element.closest(EDITABLE)) return false
	if (element.ownerDocument?.querySelector('[role="dialog"]')) return false
	const isPage =
		element === element.ownerDocument?.body ||
		element === element.ownerDocument?.documentElement
	return isPage || Boolean(canvas?.contains(element))
}

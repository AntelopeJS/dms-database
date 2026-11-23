/** A document that reports the open dialog and the page element a test sets. */
export class FakeDocument {
	body: FakeElement | null = null
	documentElement = null

	constructor(private readonly dialogOpen: boolean) {}

	querySelector(selector: string): Record<string, never> | null {
		return this.dialogOpen && selector.includes('dialog') ? {} : null
	}
}

/** An element that matches the selectors a test names, in a fake document. */
export class FakeElement extends EventTarget {
	constructor(
		private readonly matches: Record<string, boolean>,
		readonly ownerDocument: FakeDocument,
	) {
		super()
	}

	closest(selector: string): FakeElement | null {
		return Object.entries(this.matches).some(
			([part, hit]) => hit && selector.includes(part),
		)
			? this
			: null
	}
}

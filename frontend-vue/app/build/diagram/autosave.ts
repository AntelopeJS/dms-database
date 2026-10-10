import { clonePositions, type DiagramState } from './history'

// When the diagram of one schema is written (D-2): a change waits for a short
// pause, then its differences go out through that schema's writer. The state
// is copied the moment a write is asked for, so the canvas loading another
// schema afterwards never reaches it; writes run one after the other.

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** What writes one schema's diagram: a DiagramSync. */
export interface DiagramWriter {
	hasChanges(state: DiagramState): boolean
	save(state: DiagramState): Promise<void>
}

function snapshotState(state: DiagramState): DiagramState {
	return {
		positions: clonePositions(state.positions),
		notes: state.notes.map((note) => ({ ...note })),
	}
}

export class DiagramAutosave {
	private timer: ReturnType<typeof setTimeout> | null = null
	private writes: Promise<void> = Promise.resolve()

	constructor(
		private readonly writer: DiagramWriter,
		/** The state to write, read when the write is asked for. */
		private readonly read: () => DiagramState,
		private readonly delayMs: number,
		private readonly onStatus: (status: SaveStatus) => void,
	) {}

	/** Saves once edits pause. */
	schedule() {
		this.stopTimer()
		this.timer = setTimeout(() => void this.flush(), this.delayMs)
	}

	/**
	 * Writes a scheduled save now, from a copy of the state taken at once.
	 * Resolves once every write asked for so far has ended.
	 */
	flush(): Promise<void> {
		if (this.timer === null) return this.writes
		this.stopTimer()
		const state = snapshotState(this.read())
		this.writes = this.writes.then(() => this.write(state))
		return this.writes
	}

	private stopTimer() {
		if (this.timer !== null) clearTimeout(this.timer)
		this.timer = null
	}

	private async write(state: DiagramState) {
		// Nothing left to write, say after an undo: an earlier error is moot.
		if (!this.writer.hasChanges(state)) {
			this.onStatus('idle')
			return
		}
		this.onStatus('saving')
		try {
			await this.writer.save(state)
			this.onStatus('saved')
		} catch {
			this.onStatus('error')
		}
	}
}

import { clonePositions, type DiagramState } from './history'

// When the diagram is written (D-2): a change waits for a short pause, and
// each save belongs to the schema it was made in. A save pending for one
// schema is written before one for another is scheduled, and the saves run
// one after the other, so a schema's state never goes out under another's id.

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** One schema's writer: a DiagramSync. */
export interface SaveOwner {
	readonly schemaId: string
	hasChanges(state: DiagramState): boolean
	save(state: DiagramState): Promise<void>
}

/** Returns the state to write, or null when there is nothing to write. */
export type ReadState = () => DiagramState | null

export function snapshotState(state: DiagramState): DiagramState {
	return {
		positions: clonePositions(state.positions),
		notes: state.notes.map((note) => ({ ...note })),
	}
}

interface PendingSave {
	owner: SaveOwner
	read: ReadState
}

export class DiagramAutosave {
	private timer: ReturnType<typeof setTimeout> | null = null
	private pending: PendingSave | null = null
	private queue: Promise<void> = Promise.resolve()
	private writing = 0

	constructor(
		private readonly delayMs: number,
		private readonly onStatus: (owner: SaveOwner, status: SaveStatus) => void,
	) {}

	/** A save is waiting for its delay, or being written. */
	get busy(): boolean {
		return this.pending !== null || this.writing > 0
	}

	/**
	 * Saves what `read` returns under `owner` once edits pause. A save pending
	 * for another owner is written first, with that owner.
	 */
	schedule(owner: SaveOwner, read: ReadState) {
		if (this.pending && this.pending.owner !== owner) void this.flush()
		this.pending = { owner, read }
		this.stopTimer()
		this.timer = setTimeout(() => void this.flush(), this.delayMs)
	}

	/**
	 * Writes the pending save without waiting for the delay. Its state is read
	 * when its turn comes, after the saves before it.
	 */
	flush(): Promise<void> {
		this.stopTimer()
		const job = this.pending
		this.pending = null
		if (job) this.queue = this.queue.then(() => this.write(job))
		return this.queue
	}

	private stopTimer() {
		if (this.timer !== null) clearTimeout(this.timer)
		this.timer = null
	}

	private async write({ owner, read }: PendingSave) {
		const state = read()
		if (!state) return
		const snapshot = snapshotState(state)
		// Nothing left to write, say after an undo: an earlier error is moot.
		if (!owner.hasChanges(snapshot)) {
			this.onStatus(owner, 'idle')
			return
		}
		this.writing += 1
		this.onStatus(owner, 'saving')
		try {
			await owner.save(snapshot)
			this.onStatus(owner, 'saved')
		} catch {
			this.onStatus(owner, 'error')
		} finally {
			this.writing -= 1
		}
	}
}

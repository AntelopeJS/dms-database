/** The procedure step whose write is running. */
export interface AutomationOrigin {
  procedureId: string;
  runId: string;
}

/**
 * Where a procedure's write lands. An absent schema or table, or the instance
 * `"*"`, matches every one.
 */
export interface WriteTarget {
  schema?: string;
  table?: string;
  instance?: string;
}

/** A change a table watch read, located. */
export interface ChangeLocation {
  schema: string;
  table: string;
  /** Undefined when the change does not say: it matches a write to any instance. */
  instance: string | undefined;
}

/** A procedure's write a change is attributed to. */
export interface AttributedWrite extends AutomationOrigin {
  writeId: number;
}

/**
 * How long after a procedure's write ends its changes may still reach a
 * table watch, in milliseconds: a change feed delivers a change after its
 * write commits, and a polled feed (PostgreSQL, MySQL) on its next poll.
 */
export const WRITE_SETTLE_MS = 10_000;

interface ProcedureWrite extends AttributedWrite {
  target: WriteTarget;
  /** When the write ended; undefined while it runs. */
  settledAt?: number;
  /** Rows the write changed, once it ended; undefined when unknown. */
  changes?: number;
  /** Changes attributed so far, per watch: each watch reads each change once. */
  claimed: Map<string, number>;
}

function matches(target: WriteTarget, change: ChangeLocation): boolean {
  return (
    (target.schema === undefined || target.schema === change.schema) &&
    (target.table === undefined || target.table === change.table) &&
    (target.instance === undefined ||
      target.instance === "*" ||
      change.instance === undefined ||
      target.instance === change.instance)
  );
}

/**
 * The procedure writes this process runs, so a table watch can tell the
 * changes they make from a person's. A change feed carries no origin: a
 * change is attributed to a write of the same table and instance that is
 * running, or that ended less than {@link WRITE_SETTLE_MS} ago and has
 * changes left to attribute to that watch (its changed-row count, or any
 * number when the store did not say how many). The registry is per process:
 * a write another instance runs is not in it.
 */
export class ProcedureWriteRegistry {
  private readonly writes: ProcedureWrite[] = [];
  private nextId = 1;

  constructor(private readonly settleMs = WRITE_SETTLE_MS) {}

  /**
   * Records a write as running.
   *
   * @returns The write's id, for {@link settle}
   */
  begin(origin: AutomationOrigin, target: WriteTarget): number {
    const writeId = this.nextId++;
    this.writes.push({
      writeId,
      procedureId: origin.procedureId,
      runId: origin.runId,
      target,
      claimed: new Map(),
    });
    return writeId;
  }

  /**
   * Records that a write ended.
   *
   * @param writeId The id {@link begin} answered
   * @param changes The rows it changed; undefined when unknown or when it failed part way
   */
  settle(writeId: number, changes: number | undefined, now = Date.now()): void {
    const write = this.writes.find((entry) => entry.writeId === writeId);
    if (!write) return;
    write.settledAt = now;
    write.changes = changes;
  }

  /**
   * The procedure write a change a watch read comes from, if any; the change
   * counts against that write for that watch. A write that ended before the
   * watch opened its feed made no change the feed reads.
   *
   * @param watch The watch that read the change, and when it opened its feed
   * @param change Where the change landed
   */
  attribute(
    watch: { id: string; openedAt: number },
    change: ChangeLocation,
    now = Date.now(),
  ): AttributedWrite | undefined {
    this.prune(now);
    const watchId = watch.id;
    for (const write of this.writes) {
      if (write.settledAt !== undefined && write.settledAt < watch.openedAt) {
        continue;
      }
      if (!matches(write.target, change)) continue;
      const claimed = write.claimed.get(watchId) ?? 0;
      if (
        write.settledAt !== undefined &&
        write.changes !== undefined &&
        claimed >= write.changes
      ) {
        continue;
      }
      write.claimed.set(watchId, claimed + 1);
      return {
        writeId: write.writeId,
        procedureId: write.procedureId,
        runId: write.runId,
      };
    }
    return undefined;
  }

  /** Forgets every write. */
  reset(): void {
    this.writes.length = 0;
  }

  private prune(now: number): void {
    const since = now - this.settleMs;
    for (let index = this.writes.length - 1; index >= 0; index--) {
      const settledAt = this.writes[index]?.settledAt;
      if (settledAt !== undefined && settledAt < since) {
        this.writes.splice(index, 1);
      }
    }
  }
}

export const procedureWrites = new ProcedureWriteRegistry();

/**
 * Runs a procedure's write, recorded in {@link procedureWrites} while it runs
 * and for {@link WRITE_SETTLE_MS} after.
 *
 * @param origin The step that writes
 * @param target Where the write lands
 * @param write The write; resolves with what it answers
 * @param changesOf The rows the answer says changed; undefined when it does not say
 */
export async function runAsProcedureWrite<T>(
  origin: AutomationOrigin,
  target: WriteTarget,
  write: () => Promise<T>,
  changesOf: (answer: T) => number | undefined,
): Promise<T> {
  const writeId = procedureWrites.begin(origin, target);
  let changes: number | undefined;
  try {
    const answer = await write();
    changes = changesOf(answer);
    return answer;
  } finally {
    procedureWrites.settle(writeId, changes);
  }
}

import { Logging } from "@antelopejs/interface-core/logging";

export const LOOP_GUARD_LIMIT = 5;
export const LOOP_GUARD_WINDOW_MS = 60_000;

/**
 * Circuit breaker for changes procedures make: a subject admits the changes
 * of at most {@link LOOP_GUARD_LIMIT} procedure writes within
 * {@link LOOP_GUARD_WINDOW_MS}; changes of a later write are dropped. Every
 * change of an admitted write passes, so one write of many rows is not cut
 * short, while a procedure answering its own writes, or two procedures
 * answering each other, stop after a few rounds. Counts are per process.
 */
export class AutomationLoopGuard {
  private readonly admitted = new Map<string, Map<number, number>>();

  constructor(
    private readonly limit = LOOP_GUARD_LIMIT,
    private readonly windowMs = LOOP_GUARD_WINDOW_MS,
  ) {}

  /**
   * Whether a change of a write may fire.
   *
   * @param subject What the breaker counts writes for
   * @param writeId The write the change comes from
   */
  admit(subject: string, writeId: number, now = Date.now()): boolean {
    const since = now - this.windowMs;
    for (const [key, writes] of this.admitted) {
      for (const [id, at] of writes) if (at <= since) writes.delete(id);
      if (writes.size === 0) this.admitted.delete(key);
    }
    const writes = this.admitted.get(subject) ?? new Map<number, number>();
    if (writes.has(writeId)) return true;
    if (writes.size >= this.limit) return false;
    writes.set(writeId, now);
    this.admitted.set(subject, writes);
    return true;
  }

  reset(): void {
    this.admitted.clear();
  }
}

export const automationLoopGuard = new AutomationLoopGuard();

/**
 * Whether a change a procedure's write made may fire a table watch, logging a
 * warning when the breaker drops it.
 *
 * @param watch The watch, as its log label names it
 * @param subject The watch and the procedure that wrote
 * @param writeId The write
 */
export function admitAutomationChange(
  watch: string,
  subject: string,
  writeId: number,
): boolean {
  if (automationLoopGuard.admit(subject, writeId)) return true;
  Logging.Warn(
    `[dms-database] automation loop guard dropped a change on ${watch}: more than ${LOOP_GUARD_LIMIT} procedure writes within ${LOOP_GUARD_WINDOW_MS / 1000} s`,
  );
  return false;
}

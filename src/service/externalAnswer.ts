import { OWN_CONNECTION } from "../types/constants";
import { TIMED_OUT, withDeadline } from "../utils/deadline";
import type { Database } from "./database";

/** The longest a page of an external database's rows may take, in milliseconds. */
export const EXTERNAL_PAGE_DEADLINE_MS = 10_000;

/**
 * Queries in flight at once when every table of a database is counted or
 * sampled: a schema of hundreds of tables never opens one query per table.
 */
export const TABLE_FAN_OUT_LIMIT = 8;

/**
 * An external database's answer, or `fallback` when it takes longer than
 * {@link EXTERNAL_PAGE_DEADLINE_MS}: a count or a sample that feeds a list
 * answers the list late rather than never. The project's own database is
 * waited for. The query keeps running in the database after the deadline.
 *
 * @param db The database the work reads
 * @param work The work
 * @param fallback What stands in for a late answer
 */
export async function externalAnswer<T>(
  db: Database,
  work: Promise<T>,
  fallback: T,
): Promise<T> {
  if (db.connection === OWN_CONNECTION) return work;
  const answer = await withDeadline(work, EXTERNAL_PAGE_DEADLINE_MS);
  return answer === TIMED_OUT ? fallback : answer;
}

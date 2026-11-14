/** What {@link withDeadline} answers when the work did not settle in time. */
export const TIMED_OUT = Symbol("timed out");

/**
 * Waits for work, at most `ms` milliseconds. The work keeps running past the
 * deadline: this frees the request that waits for it, it does not cancel it.
 *
 * @param work The work
 * @param ms The most it may take
 * @returns What the work answered, or {@link TIMED_OUT}
 */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

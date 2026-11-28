/**
 * `items.map(work)`, awaited, with at most `limit` calls of `work` in flight
 * at once. The results keep the items' order. One rejection rejects the whole
 * call, as `Promise.all` does.
 *
 * @param items What to work on
 * @param limit The most calls in flight at once, at least one
 * @param work The asynchronous work on one item
 * @returns The answers, in the items' order
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const pending = items.entries();
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (const [index, item] of pending) {
        results[index] = await work(item, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

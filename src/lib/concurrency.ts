/**
 * Runs `worker` over `items` with at most `limit` in flight at once.
 *
 * Why this exists: bulk-status chunks (50 ids each) could total 10+ calls
 * for a big selection. Firing them all via Promise.all risks the 80
 * requests/10s limit (API.md) — and a 429 mid-batch means re-deriving which
 * ids actually got applied. A small worker pool keeps steady, bounded load
 * instead.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    const current = nextIndex++;
    const item = items[current];
    if (item === undefined) return;
    results[current] = await worker(item);
    return runNext();
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));

  return results;
}
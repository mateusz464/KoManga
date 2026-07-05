// Runs `task` over `items` with at most `limit` in flight at once, keeping the
// result in input order regardless of completion order.
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const workers = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  const runWorker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await task(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: workers }, () => runWorker()));
  return results;
}

/** Run async work over items with a fixed concurrency cap. Preserves result order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let next = 0;

  await Promise.all(Array.from({ length: limit }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  }));

  return results;
}

export const ANALYZE_CONCURRENCY = 4;
export const WARM_FOLDER_CONCURRENCY = 4;
export const HASH_FILE_CONCURRENCY = 8;

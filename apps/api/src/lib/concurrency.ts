/** Run async tasks with a maximum concurrency limit. */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const concurrency = Math.max(1, limit);
  let index = 0;

  async function next(): Promise<void> {
    while (index < items.length) {
      const current = items[index++]!;
      await worker(current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
}

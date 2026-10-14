/** Small concurrency helpers of the print pipeline. */

/**
 * One FIFO queue per key: tasks with the same key run one after another (a printer never gets two jobs
 * interleaved), tasks of different keys run in parallel. A failed task does not stop the ones after it.
 */
export class SerialQueues {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    // Forget idle keys, so printers that disappeared do not keep entries.
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** Resolves when every queued task has finished. */
  async idle(): Promise<void> {
    while (this.tails.size > 0) await Promise.all([...this.tails.values()]);
  }

  get size(): number {
    return this.tails.size;
  }
}

/** A set that keeps only the last `capacity` values added (oldest dropped first). */
export class LruSet {
  private readonly values = new Set<string>();

  constructor(private readonly capacity: number) {}

  has(value: string): boolean {
    return this.values.has(value);
  }

  add(value: string): void {
    this.values.delete(value);
    this.values.add(value);
    while (this.values.size > this.capacity) {
      const oldest = this.values.values().next();
      if (oldest.done) break;
      this.values.delete(oldest.value);
    }
  }

  get size(): number {
    return this.values.size;
  }
}

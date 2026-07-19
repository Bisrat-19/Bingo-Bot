// A tiny promise-based mutex keyed by string. Guarantees that critical sections
// for the same key run strictly one-at-a-time within this process. Combined with the
// atomic DB winner-claim, this makes simultaneous BINGO presses safe.

type Release = () => void;

export class KeyedMutex {
  private chains = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<Release> {
    const previous = this.chains.get(key) ?? Promise.resolve();

    let release!: Release;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Queue this waiter behind whatever currently holds the key.
    const chain = previous.then(() => current);
    this.chains.set(key, chain);

    await previous;
    return () => {
      release();
      // If no later waiter replaced our chain, drop the key to avoid unbounded growth.
      if (this.chains.get(key) === chain) this.chains.delete(key);
    };
  }

  // Convenience wrapper: run `fn` while holding `key`, always releasing afterwards.
  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire(key);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

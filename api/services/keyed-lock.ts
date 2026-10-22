/** Serialize quota checks and task reservation in this process. No lock spans an AI call. */
export function createKeyedLock() {
  const tails = new Map<string, Promise<void>>();

  async function withKey<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => {
      release = resolve;
    });
    tails.set(key, current);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (tails.get(key) === current) tails.delete(key);
    }
  }

  return function withKeys<T>(
    keys: string[],
    action: () => Promise<T>
  ): Promise<T> {
    // Consistent ordering avoids deadlocks for overlapping guest/IP identities.
    const ordered = [...new Set(keys)].sort();
    const acquire = (index: number): Promise<T> =>
      index === ordered.length
        ? action()
        : withKey(ordered[index], () => acquire(index + 1));
    return acquire(0);
  };
}

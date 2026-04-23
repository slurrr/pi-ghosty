export class Semaphore {
  private permits: number;
  private readonly queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = Math.max(1, permits);
  }

  tryAcquire(): (() => void) | null {
    if (this.permits <= 0) return null;
    this.permits -= 1;
    return () => this.release();
  }

  async acquire(): Promise<() => void> {
    const release = this.tryAcquire();
    if (release) return release;

    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.permits -= 1;
    return () => this.release();
  }

  private release(): void {
    this.permits += 1;
    const next = this.queue.shift();
    if (next) next();
  }

  async withPermit<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(key, prev.then(() => next));

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === next) {
        this.tails.delete(key);
      }
    }
  }

  keys(): string[] {
    return [...this.tails.keys()];
  }
}

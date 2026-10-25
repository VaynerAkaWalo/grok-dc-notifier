type Clock = () => number;

// Remembers message IDs for a TTL.
export class Dedupe {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: Clock = Date.now,
  ) {}

  // True the first time an ID is seen within the TTL.
  first(id: string): boolean {
    const now = this.now();

    for (const [key, at] of this.seen) {
      if (now - at > this.ttlMs) {
        this.seen.delete(key);
      }
    }

    if (this.seen.has(id)) {
      return false;
    }

    this.seen.set(id, now);

    return true;
  }
}

// Allows at most `perMinute` events in any sliding 60 s window.
export class Limiter {
  private times: number[] = [];

  constructor(
    private readonly perMinute: number,
    private readonly now: Clock = Date.now,
  ) {}

  allow(): boolean {
    const now = this.now();

    this.times = this.times.filter((at) => now - at < 60_000);

    if (this.times.length >= this.perMinute) {
      return false;
    }

    this.times.push(now);

    return true;
  }
}

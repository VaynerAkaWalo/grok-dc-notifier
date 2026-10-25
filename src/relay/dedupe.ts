export class Dedupe {
  private readonly seenAt = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  isFirstSighting(id: string): boolean {
    const now = this.now();

    this.dropExpired(now);

    if (this.seenAt.has(id)) {
      return false;
    }

    this.seenAt.set(id, now);

    return true;
  }

  private dropExpired(now: number) {
    for (const [id, at] of this.seenAt) {
      if (now - at > this.ttlMs) {
        this.seenAt.delete(id);
      }
    }
  }
}

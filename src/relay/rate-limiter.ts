const windowMs = 60_000;

export class RateLimiter {
  private acceptedAt: number[] = [];

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  tryAcquire(): boolean {
    const now = this.now();

    this.acceptedAt = this.acceptedAt.filter((at) => now - at < windowMs);

    if (this.acceptedAt.length >= this.perMinute) {
      return false;
    }

    this.acceptedAt.push(now);

    return true;
  }
}

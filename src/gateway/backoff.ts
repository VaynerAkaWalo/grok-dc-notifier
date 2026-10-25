export class Backoff {
  private currentMs: number;

  constructor(
    private readonly minMs: number,
    private readonly maxMs: number,
    private readonly random: () => number = Math.random,
  ) {
    this.currentMs = minMs;
  }

  nextDelayMs(): number {
    const jitterMs = Math.floor(this.random() * (this.currentMs / 2));
    const delayMs = this.currentMs + jitterMs;

    this.currentMs = Math.min(this.currentMs * 2, this.maxMs);

    return delayMs;
  }

  reset() {
    this.currentMs = this.minMs;
  }
}

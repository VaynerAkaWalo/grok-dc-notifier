export class Heartbeat {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private acknowledged = true;

  constructor(
    private readonly beat: () => void,
    private readonly onMissedAck: () => void,
    private readonly random: () => number = Math.random,
  ) {}

  start(intervalMs: number) {
    const jitteredFirstBeatMs = Math.floor(intervalMs * this.random());

    this.schedule(jitteredFirstBeatMs, intervalMs);
  }

  acknowledge() {
    this.acknowledged = true;
  }

  stop() {
    clearTimeout(this.timer);
  }

  private schedule(delayMs: number, intervalMs: number) {
    this.timer = setTimeout(() => {
      if (!this.acknowledged) {
        this.onMissedAck();

        return;
      }

      this.acknowledged = false;
      this.beat();
      this.schedule(intervalMs, intervalMs);
    }, delayMs);
  }
}

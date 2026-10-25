export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.pending;
  }

  tryEnqueue(
    task: () => Promise<void>,
    onError: (err: unknown) => void,
  ): boolean {
    if (this.pending >= this.capacity) {
      return false;
    }

    this.pending++;
    this.tail = this.tail
      .then(task)
      .catch(onError)
      .finally(() => {
        this.pending--;
      });

    return true;
  }

  async drained(): Promise<void> {
    while (this.pending > 0) {
      await this.tail;
    }
  }
}

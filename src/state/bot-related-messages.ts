import { maxCachedEntries } from "./cache-limits.ts";

const retentionWhenFullMs = 24 * 3_600_000;

export class BotRelatedMessages {
  private readonly seenAt = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  add(messageId: string) {
    if (this.seenAt.size >= maxCachedEntries) {
      this.makeRoom();
    }

    this.seenAt.set(messageId, this.now());
  }

  has(messageId: string): boolean {
    return this.seenAt.has(messageId);
  }

  private makeRoom() {
    const cutoff = this.now() - retentionWhenFullMs;

    for (const [id, at] of this.seenAt) {
      if (at < cutoff) {
        this.seenAt.delete(id);
      }
    }

    if (this.seenAt.size >= maxCachedEntries) {
      this.seenAt.clear();
    }
  }
}

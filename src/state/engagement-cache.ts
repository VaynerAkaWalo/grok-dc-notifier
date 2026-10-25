import { BoundedMap } from "./bounded-map.ts";
import { maxCachedEntries } from "./cache-limits.ts";

interface Answer {
  engaged: boolean;
  at: number;
}

export class EngagementCache {
  private readonly answers = new BoundedMap<string, Answer>(maxCachedEntries);

  constructor(
    private readonly negativeTtlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  remember(threadId: string, engaged: boolean) {
    const wouldDowngrade = !engaged && this.answers.get(threadId)?.engaged;

    if (wouldDowngrade) {
      return;
    }

    this.answers.set(threadId, { engaged, at: this.now() });
  }

  lookup(threadId: string): boolean | undefined {
    const answer = this.answers.get(threadId);

    if (!answer) {
      return undefined;
    }

    if (!answer.engaged && this.now() - answer.at > this.negativeTtlMs) {
      this.answers.delete(threadId);

      return undefined;
    }

    return answer.engaged;
  }

  forget(threadId: string) {
    this.answers.delete(threadId);
  }
}

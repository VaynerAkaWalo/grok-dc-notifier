import {
  type Channel,
  isThread,
  type Message,
  type Role,
} from "../discord/types.ts";

const maxEntries = 20_000;

interface Engagement {
  engaged: boolean;
  at: number;
}

// In-memory knowledge about the bot, channels and threads. Only the single
// event worker touches it, so no locking is needed.
export class State {
  botId = "";
  readonly botRoles = new Set<string>();
  readonly channels = new Map<string, Channel>();
  private readonly engagement = new Map<string, Engagement>();
  // Message IDs authored by or mentioning the bot.
  private readonly related = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  role(role: Role) {
    if (this.botId && role.tags?.bot_id === this.botId) {
      this.botRoles.add(role.id);
    }
  }

  channel(channel: Channel) {
    if (!channel.id) {
      return;
    }

    if (this.channels.size >= maxEntries) {
      this.channels.clear();
    }

    this.channels.set(channel.id, channel);

    if (
      isThread(channel) &&
      this.botId &&
      (channel.owner_id === this.botId || this.isRelated(channel.id))
    ) {
      this.setEngaged(channel.id, true);
    }
  }

  forget(id: string) {
    this.channels.delete(id);
    this.engagement.delete(id);
  }

  mentionsBot(message: Message): boolean {
    if (!this.botId) {
      return false;
    }

    return (
      (message.mentions ?? []).some((user) => user.id === this.botId) ||
      (message.mention_roles ?? []).some((id) => this.botRoles.has(id))
    );
  }

  markRelated(id: string) {
    if (this.related.size >= maxEntries) {
      const cutoff = this.now() - 24 * 3_600_000;

      for (const [key, at] of this.related) {
        if (at < cutoff) {
          this.related.delete(key);
        }
      }

      if (this.related.size >= maxEntries) {
        this.related.clear();
      }
    }

    this.related.set(id, this.now());
  }

  isRelated(id: string): boolean {
    return this.related.has(id);
  }

  setEngaged(threadId: string, engaged: boolean) {
    // Never downgrade a positive answer.
    if (!engaged && this.engagement.get(threadId)?.engaged) {
      return;
    }

    if (this.engagement.size >= maxEntries) {
      this.engagement.clear();
    }

    this.engagement.set(threadId, { engaged, at: this.now() });
  }

  // Cached answer, or undefined. Negative answers expire after negativeTtlMs.
  engagedCached(threadId: string, negativeTtlMs: number): boolean | undefined {
    const entry = this.engagement.get(threadId);

    if (!entry) {
      return undefined;
    }

    if (!entry.engaged && this.now() - entry.at > negativeTtlMs) {
      this.engagement.delete(threadId);

      return undefined;
    }

    return entry.engaged;
  }
}

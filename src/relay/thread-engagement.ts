import { type Channel, isThread } from "../discord/schemas.ts";
import type { Logger } from "../infra/logger.ts";
import type { BotIdentity } from "../state/bot-identity.ts";
import type { BotRelatedMessages } from "../state/bot-related-messages.ts";
import type { EngagementCache } from "../state/engagement-cache.ts";
import type { EngagementLookup } from "./engagement-lookup.ts";

export class ThreadEngagement {
  constructor(
    private readonly cache: EngagementCache,
    private readonly related: BotRelatedMessages,
    private readonly identity: BotIdentity,
    private readonly lookup: EngagementLookup,
    private readonly log: Logger,
  ) {}

  rememberBotRelatedMessage(messageId: string) {
    this.related.add(messageId);
  }

  markEngaged(threadId: string) {
    this.cache.remember(threadId, true);
  }

  channelSeen(channel: Channel) {
    if (!isThread(channel) || !this.identity.known) {
      return;
    }

    const createdByBot = channel.owner_id === this.identity.id;
    const startedFromBotRelatedMessage = this.related.has(channel.id);

    if (createdByBot || startedFromBotRelatedMessage) {
      this.markEngaged(channel.id);
    }
  }

  forget(threadId: string) {
    this.cache.forget(threadId);
  }

  async isEngaged(thread: Channel): Promise<boolean> {
    const cached = this.cache.lookup(thread.id);

    if (cached !== undefined) {
      return cached;
    }

    try {
      const { engaged, via } = await this.lookup.check(thread);

      this.cache.remember(thread.id, engaged);
      this.log.info(
        {
          threadId: thread.id,
          engaged,
          via,
        },
        "thread engagement resolved",
      );

      return engaged;
    } catch (err) {
      this.log.warn(
        {
          threadId: thread.id,
          err,
        },
        "thread engagement lookup failed",
      );

      return false;
    }
  }
}

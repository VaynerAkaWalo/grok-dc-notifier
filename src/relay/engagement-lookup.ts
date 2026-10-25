import { type DiscordApi, NotFoundError } from "../discord/rest-client.ts";
import type { Channel, Message } from "../discord/schemas.ts";
import type { BotIdentity } from "../state/bot-identity.ts";
import type { BotRelatedMessages } from "../state/bot-related-messages.ts";

export interface EngagementVerdict {
  engaged: boolean;
  via: string;
}

const recentHistoryLimit = 100;

export class EngagementLookup {
  constructor(
    private readonly identity: BotIdentity,
    private readonly related: BotRelatedMessages,
    private readonly api: DiscordApi,
  ) {}

  async check(thread: Channel): Promise<EngagementVerdict> {
    if (!this.identity.known) {
      throw new Error("bot user id unknown");
    }

    if (thread.owner_id === this.identity.id) {
      return { engaged: true, via: "bot created thread" };
    }

    if (this.related.has(thread.id)) {
      return { engaged: true, via: "starter message seen" };
    }

    const starter = await this.findStarterMessage(thread);

    if (starter && this.identity.involvedIn(starter)) {
      return { engaged: true, via: "starter message" };
    }

    const history = await this.recentMessages(thread);

    if (history.some((message) => this.identity.involvedIn(message))) {
      return { engaged: true, via: "thread history" };
    }

    return {
      engaged: false,
      via: `not found in starter or last ${recentHistoryLimit} messages`,
    };
  }

  private async findStarterMessage(
    thread: Channel,
  ): Promise<Message | undefined> {
    const starterMessageId = thread.id;
    const channelsThatMayHoldStarter = [thread.parent_id, thread.id];

    for (const channelId of channelsThatMayHoldStarter) {
      if (!channelId) {
        continue;
      }

      const starter = await this.ignoringNotFound(() =>
        this.api.message(channelId, starterMessageId),
      );

      if (starter) {
        return starter;
      }
    }

    return undefined;
  }

  private async recentMessages(thread: Channel): Promise<Message[]> {
    const history = await this.ignoringNotFound(() =>
      this.api.messages(thread.id, recentHistoryLimit),
    );

    return history ?? [];
  }

  private async ignoringNotFound<T>(
    request: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await request();
    } catch (err) {
      if (err instanceof NotFoundError) {
        return undefined;
      }

      throw err;
    }
  }
}

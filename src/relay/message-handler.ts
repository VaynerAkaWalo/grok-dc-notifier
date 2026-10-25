import { type Channel, isThread, type Message } from "../discord/schemas.ts";
import type { Logger } from "../infra/logger.ts";
import type { BotIdentity } from "../state/bot-identity.ts";
import type { AccessPolicy } from "./access-policy.ts";
import type { ChannelDirectory } from "./channel-directory.ts";
import type { Forwarder } from "./forwarder.ts";
import type { ThreadEngagement } from "./thread-engagement.ts";
import { type Trigger, toWebhookEvent } from "./webhook-event.ts";

export class MessageHandler {
  constructor(
    private readonly access: AccessPolicy,
    private readonly identity: BotIdentity,
    private readonly channels: ChannelDirectory,
    private readonly engagement: ThreadEngagement,
    private readonly forwarder: Forwarder,
    private readonly log: Logger,
  ) {}

  async handle(message: Message) {
    if (!this.access.allowsGuild(message.guild_id)) {
      return;
    }

    const byBot = this.identity.authored(message);
    const mentionsBot = this.identity.mentionedIn(message);
    const channel = await this.learnEngagement(message, byBot || mentionsBot);

    if (byBot || message.author.bot || message.webhook_id) {
      return;
    }

    if (!this.access.allowsAuthor(message.author.id)) {
      this.log.debug(
        {
          messageId: message.id,
          reason: "author not allowed",
        },
        "skipped",
      );

      return;
    }

    const trigger = await this.triggerFor(message, mentionsBot, channel);

    if (!trigger) {
      this.log.debug(
        {
          messageId: message.id,
          channelId: message.channel_id,
          reason: "no mention, not a dm, not an engaged thread",
        },
        "skipped",
      );

      return;
    }

    this.forwarder.forward(toWebhookEvent(message, trigger, channel));
  }

  private async learnEngagement(
    message: Message,
    involvesBot: boolean,
  ): Promise<Channel | undefined> {
    if (involvesBot) {
      this.engagement.rememberBotRelatedMessage(message.id);
    }

    const channel = message.guild_id
      ? await this.channels.resolve(message.channel_id)
      : undefined;

    if (involvesBot && isThread(channel)) {
      this.engagement.markEngaged(channel.id);
    }

    return channel;
  }

  private async triggerFor(
    message: Message,
    mentionsBot: boolean,
    channel: Channel | undefined,
  ): Promise<Trigger | undefined> {
    if (!message.guild_id) {
      return "dm";
    }

    if (mentionsBot) {
      return "mention";
    }

    if (isThread(channel) && (await this.engagement.isEngaged(channel))) {
      return "engaged_thread";
    }

    return undefined;
  }
}

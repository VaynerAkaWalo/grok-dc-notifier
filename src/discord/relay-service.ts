import type { DiscordRestClient } from "./rest-client.ts";

const allowedGuildId = "1561814224538304512";
const defaultHistoryLimit = 50;

export class GuildForbiddenError extends Error {
  constructor() {
    super("guild forbidden");
  }
}

export type RelayDiscord = Pick<
  DiscordRestClient,
  | "channel"
  | "relayMessage"
  | "relayMessages"
  | "createThread"
  | "postMessage"
  | "addReaction"
>;

export class DiscordRelayService {
  constructor(private readonly discord: RelayDiscord) {}

  async createThread(
    channelId: string,
    messageId: string,
    body: { name: string; auto_archive_duration?: number },
  ) {
    await this.requireAllowedGuild(channelId);

    return this.discord.createThread(channelId, messageId, body);
  }

  async postMessage(channelId: string, content: string, replyTo?: string) {
    await this.requireAllowedGuild(channelId);

    return this.discord.postMessage(channelId, content, replyTo);
  }

  async listMessages(channelId: string, limit?: number, before?: string) {
    await this.requireAllowedGuild(channelId);

    const query = new URLSearchParams({
      limit: String(limit ?? defaultHistoryLimit),
    });
    if (before) query.set("before", before);

    return this.discord.relayMessages(channelId, query);
  }

  async getMessage(channelId: string, messageId: string) {
    await this.requireAllowedGuild(channelId);

    return this.discord.relayMessage(channelId, messageId);
  }

  async addReaction(channelId: string, messageId: string, emoji: string) {
    await this.requireAllowedGuild(channelId);

    await this.discord.addReaction(channelId, messageId, emoji);
  }

  private async requireAllowedGuild(channelId: string) {
    const channel = await this.discord.channel(channelId);
    if (channel.guild_id !== allowedGuildId) throw new GuildForbiddenError();
  }
}

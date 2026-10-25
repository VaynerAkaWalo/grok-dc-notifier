import type { DiscordApi } from "../discord/rest-client.ts";
import type { Channel } from "../discord/schemas.ts";
import type { Logger } from "../infra/logger.ts";
import { BoundedMap } from "../state/bounded-map.ts";
import { maxCachedEntries } from "../state/cache-limits.ts";
import type { ThreadEngagement } from "./thread-engagement.ts";

export class ChannelDirectory {
  private readonly channels = new BoundedMap<string, Channel>(maxCachedEntries);

  constructor(
    private readonly engagement: ThreadEngagement,
    private readonly api: DiscordApi,
    private readonly log: Logger,
  ) {}

  remember(channel: Channel) {
    if (!channel.id) {
      return;
    }

    this.channels.set(channel.id, channel);
    this.engagement.channelSeen(channel);
  }

  forget(channelId: string) {
    this.channels.delete(channelId);
    this.engagement.forget(channelId);
  }

  async resolve(channelId: string): Promise<Channel | undefined> {
    const cached = this.channels.get(channelId);

    if (cached) {
      return cached;
    }

    try {
      const channel = await this.api.channel(channelId);

      this.remember(channel);

      return channel;
    } catch (err) {
      this.log.warn({ channelId, err }, "channel lookup failed");

      return undefined;
    }
  }
}

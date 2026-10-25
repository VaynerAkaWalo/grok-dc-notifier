import type { DiscordApi } from "../discord/rest-client.ts";
import {
  channelSchema,
  guildSchema,
  messageSchema,
  roleDeleteSchema,
  roleEventSchema,
  threadListSyncSchema,
} from "../discord/schemas.ts";
import type { Logger } from "../infra/logger.ts";
import { BotIdentity } from "../state/bot-identity.ts";
import { BotRelatedMessages } from "../state/bot-related-messages.ts";
import { EngagementCache } from "../state/engagement-cache.ts";
import { AccessPolicy } from "./access-policy.ts";
import { ChannelDirectory } from "./channel-directory.ts";
import type { Dedupe } from "./dedupe.ts";
import { EngagementLookup } from "./engagement-lookup.ts";
import { EventRouter } from "./event-router.ts";
import { Forwarder } from "./forwarder.ts";
import { GuildEvents } from "./guild-events.ts";
import { MessageHandler } from "./message-handler.ts";
import type { RateLimiter } from "./rate-limiter.ts";
import { Relay } from "./relay.ts";
import { ThreadEngagement } from "./thread-engagement.ts";
import type { WebhookSender } from "./webhook-client.ts";

export interface RelayOptions {
  allowedUserIds: Set<string>;
  allowedGuildIds: Set<string>;
  api: DiscordApi;
  dedupe: Dedupe;
  limiter: RateLimiter;
  negativeTtlMs: number;
  webhook: WebhookSender;
  log: Logger;
  now?: () => number;
}

export function createRelay(options: RelayOptions): Relay {
  const { log } = options;
  const identity = new BotIdentity();
  const related = new BotRelatedMessages(options.now);
  const engagement = new ThreadEngagement(
    new EngagementCache(options.negativeTtlMs, options.now),
    related,
    identity,
    new EngagementLookup(identity, related, options.api),
    log,
  );
  const channels = new ChannelDirectory(engagement, options.api, log);
  const forwarder = new Forwarder(
    options.dedupe,
    options.limiter,
    options.webhook,
    log,
  );
  const guildEvents = new GuildEvents(identity, channels, log);
  const messages = new MessageHandler(
    new AccessPolicy(options.allowedUserIds, options.allowedGuildIds),
    identity,
    channels,
    engagement,
    forwarder,
    log,
  );

  const router = new EventRouter(log)
    .on(["GUILD_CREATE"], guildSchema, (guild) =>
      guildEvents.guildCreated(guild),
    )
    .on(["GUILD_ROLE_CREATE", "GUILD_ROLE_UPDATE"], roleEventSchema, (e) =>
      guildEvents.roleChanged(e.role),
    )
    .on(["GUILD_ROLE_DELETE"], roleDeleteSchema, (e) =>
      guildEvents.roleDeleted(e.role_id),
    )
    .on(
      ["CHANNEL_CREATE", "CHANNEL_UPDATE", "THREAD_CREATE", "THREAD_UPDATE"],
      channelSchema,
      (channel) => guildEvents.channelChanged(channel),
    )
    .on(["CHANNEL_DELETE", "THREAD_DELETE"], channelSchema, (channel) =>
      guildEvents.channelDeleted(channel),
    )
    .on(["THREAD_LIST_SYNC"], threadListSyncSchema, (e) =>
      guildEvents.threadsSynced(e.threads ?? []),
    )
    .on(["MESSAGE_CREATE"], messageSchema, (message) =>
      messages.handle(message),
    );

  return new Relay(identity, router, forwarder, log);
}

// Tracks which Discord threads the bot is engaged in, decides which messages
// wake the Grok Bot routine, and POSTs them to its webhook.
//
// Forwarding rules (author must be in ALLOWED_USER_IDS and not a bot/webhook):
//   - DM to the bot                                 -> trigger "dm"
//   - message mentioning the bot user or its role   -> trigger "mention"
//   - any message in a thread the bot is engaged in -> trigger "engaged_thread"
//
// A thread is engaged when it was started from a bot message, the bot created
// it, the bot was mentioned in it, or the bot posted in it.

import { type DiscordApi, NotFoundError } from "../discord/rest.ts";
import {
  type Channel,
  type Guild,
  isThread,
  type Message,
  type Role,
} from "../discord/types.ts";
import type { Logger } from "../infra/logger.ts";
import type { Dedupe, Limiter } from "./limits.ts";
import { State } from "./state.ts";

export type Trigger = "dm" | "mention" | "engaged_thread";

export interface Author {
  id: string;
  username: string;
}

export interface WebhookEvent {
  trigger: Trigger;
  guild_id: string | null;
  channel_id: string;
  thread_id: string | null;
  parent_id: string | null;
  message_id: string;
  author: Author;
  content: string;
  timestamp: string;
  referenced_message?: {
    message_id: string;
    author: Author;
    content: string;
    timestamp?: string;
  };
}

export interface RelayOptions {
  allowedUserIds: Set<string>;
  // Empty = any guild.
  allowedGuildIds: Set<string>;
  api: DiscordApi;
  dedupe: Dedupe;
  limiter: Limiter;
  negativeTtlMs: number;
  webhookUrl: string;
  webhookAuthHeader: string;
  webhookTimeoutMs: number;
  log: Logger;
  fetch?: typeof fetch;
  now?: () => number;
}

const handledEvents = new Set([
  "GUILD_CREATE",
  "GUILD_ROLE_CREATE",
  "GUILD_ROLE_UPDATE",
  "GUILD_ROLE_DELETE",
  "CHANNEL_CREATE",
  "CHANNEL_UPDATE",
  "CHANNEL_DELETE",
  "THREAD_CREATE",
  "THREAD_UPDATE",
  "THREAD_DELETE",
  "THREAD_LIST_SYNC",
  "MESSAGE_CREATE",
]);

const maxPendingEvents = 1024;
const maxPendingPosts = 32;

const authorOf = (message: Message): Author => ({
  id: message.author.id,
  username: message.author.username ?? "",
});

// Builds the webhook body. guild_id is null for DMs; thread_id and parent_id
// are null outside threads.
export function toWebhookEvent(
  message: Message,
  trigger: Trigger,
  channel: Channel | undefined,
): WebhookEvent {
  const thread = isThread(channel) ? channel : undefined;
  const ref = message.referenced_message;

  return {
    trigger,
    guild_id: message.guild_id || null,
    channel_id: message.channel_id,
    thread_id: thread?.id ?? null,
    parent_id: thread?.parent_id ?? null,
    message_id: message.id,
    author: authorOf(message),
    content: message.content ?? "",
    timestamp: message.timestamp ?? "",
    ...(ref
      ? {
          referenced_message: {
            message_id: ref.id,
            author: authorOf(ref),
            content: ref.content ?? "",
            timestamp: ref.timestamp,
          },
        }
      : {}),
  };
}

export class Relay {
  readonly state: State;
  private events: Promise<void> = Promise.resolve();
  private pendingEvents = 0;
  private posts: Promise<void> = Promise.resolve();
  private pendingPosts = 0;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: RelayOptions) {
    this.state = new State(options.now);
    this.doFetch = options.fetch ?? fetch;
  }

  // Gateway dispatch handler. Only enqueues, so the gateway never blocks;
  // events are processed one at a time in arrival order.
  handle = (type: string, data: unknown, botUserId: string) => {
    if (!handledEvents.has(type)) {
      return;
    }

    if (this.pendingEvents >= maxPendingEvents) {
      this.options.log.warn("event queue full, dropping", { event: type });

      return;
    }

    this.pendingEvents++;
    this.events = this.events
      .then(() => this.process(type, data, botUserId))
      .catch((err) =>
        this.options.log.error("event processing failed", { event: type, err }),
      )
      .finally(() => {
        this.pendingEvents--;
      });
  };

  // Resolves once all queued events and webhook posts are done.
  async idle(): Promise<void> {
    while (this.pendingEvents > 0 || this.pendingPosts > 0) {
      await this.events;
      await this.posts;
    }
  }

  async process(type: string, data: unknown, botUserId: string) {
    const state = this.state;

    state.botId = botUserId;

    switch (type) {
      case "GUILD_CREATE": {
        const guild = data as Guild;

        for (const role of guild.roles ?? []) {
          state.role(role);
        }

        for (const channel of [
          ...(guild.channels ?? []),
          ...(guild.threads ?? []),
        ]) {
          state.channel({ ...channel, guild_id: guild.id });
        }

        this.options.log.info("guild loaded", {
          guildId: guild.id,
          channels: guild.channels?.length ?? 0,
          activeThreads: guild.threads?.length ?? 0,
          botRoles: state.botRoles.size,
        });

        break;
      }
      case "GUILD_ROLE_CREATE":
      case "GUILD_ROLE_UPDATE":
        state.role((data as { role: Role }).role);
        break;
      case "GUILD_ROLE_DELETE":
        state.botRoles.delete((data as { role_id: string }).role_id);
        break;
      case "CHANNEL_CREATE":
      case "CHANNEL_UPDATE":
      case "THREAD_CREATE":
      case "THREAD_UPDATE":
        state.channel(data as Channel);
        break;
      case "CHANNEL_DELETE":
      case "THREAD_DELETE":
        state.forget((data as Channel).id);
        break;
      case "THREAD_LIST_SYNC":
        for (const thread of (data as { threads?: Channel[] }).threads ?? []) {
          state.channel(thread);
        }
        break;
      case "MESSAGE_CREATE":
        await this.message(data as Message);
        break;
    }
  }

  private async message(message: Message) {
    const { state, options } = this;
    const log = options.log;

    if (
      message.guild_id &&
      options.allowedGuildIds.size > 0 &&
      !options.allowedGuildIds.has(message.guild_id)
    ) {
      return;
    }

    const byBot = state.botId !== "" && message.author.id === state.botId;
    const mentioned = state.mentionsBot(message);

    if (byBot || mentioned) {
      state.markRelated(message.id);
    }

    let channel: Channel | undefined;

    if (message.guild_id) {
      channel = await this.channel(message.channel_id);
    }

    if (channel && isThread(channel) && (byBot || mentioned)) {
      state.setEngaged(channel.id, true);
    }

    if (byBot || message.author.bot || message.webhook_id) {
      return;
    }

    if (!options.allowedUserIds.has(message.author.id)) {
      log.debug("skipped", {
        messageId: message.id,
        reason: "author not allowed",
      });

      return;
    }

    let trigger: Trigger;

    if (!message.guild_id) {
      trigger = "dm";
    } else if (mentioned) {
      trigger = "mention";
    } else if (channel && isThread(channel) && (await this.engaged(channel))) {
      trigger = "engaged_thread";
    } else {
      log.debug("skipped", {
        messageId: message.id,
        channelId: message.channel_id,
        reason: "no mention, not a dm, not an engaged thread",
      });

      return;
    }

    if (!options.dedupe.first(message.id)) {
      log.info("skipped duplicate", { messageId: message.id });

      return;
    }

    if (!options.limiter.allow()) {
      log.warn("rate limited, dropping", {
        messageId: message.id,
        channelId: message.channel_id,
      });

      return;
    }

    this.enqueuePost(toWebhookEvent(message, trigger, channel));

    log.info("queued", {
      messageId: message.id,
      channelId: message.channel_id,
      trigger,
      contentLength: message.content?.length ?? 0,
    });
  }

  private async channel(id: string): Promise<Channel | undefined> {
    const cached = this.state.channels.get(id);

    if (cached) {
      return cached;
    }

    try {
      const channel = await this.options.api.channel(id);

      this.state.channel(channel);

      return channel;
    } catch (err) {
      this.options.log.warn("channel lookup failed", { channelId: id, err });

      return undefined;
    }
  }

  // Answers from cache, otherwise asks Discord once and caches the answer.
  private async engaged(thread: Channel): Promise<boolean> {
    const cached = this.state.engagedCached(
      thread.id,
      this.options.negativeTtlMs,
    );

    if (cached !== undefined) {
      return cached;
    }

    try {
      const [engaged, via] = await this.lookupEngaged(thread);

      this.state.setEngaged(thread.id, engaged);
      this.options.log.info("thread engagement resolved", {
        threadId: thread.id,
        engaged,
        via,
      });

      return engaged;
    } catch (err) {
      // Not cached, retried on the next message.
      this.options.log.warn("thread engagement lookup failed", {
        threadId: thread.id,
        err,
      });

      return false;
    }
  }

  private async lookupEngaged(thread: Channel): Promise<[boolean, string]> {
    const { state, options } = this;

    if (!state.botId) {
      throw new Error("bot user id unknown");
    }

    if (thread.owner_id === state.botId) {
      return [true, "bot created thread"];
    }

    if (state.isRelated(thread.id)) {
      return [true, "starter message seen"];
    }

    const isBotMessage = (message: Message) =>
      message.author.id === state.botId || state.mentionsBot(message);

    // Threads started from a message share its ID; the starter lives in the
    // parent channel (text channels) or in the thread itself (forum posts).
    for (const channelId of [thread.parent_id, thread.id]) {
      if (!channelId) {
        continue;
      }

      try {
        const starter = await options.api.message(channelId, thread.id);

        if (isBotMessage(starter)) {
          return [true, "starter message"];
        }

        break;
      } catch (err) {
        if (!(err instanceof NotFoundError)) {
          throw err;
        }
      }
    }

    let history: Message[] = [];

    try {
      history = await options.api.messages(thread.id, 100);
    } catch (err) {
      if (!(err instanceof NotFoundError)) {
        throw err;
      }
    }

    if (history.some(isBotMessage)) {
      return [true, "thread history"];
    }

    return [false, "not found in starter or last 100 messages"];
  }

  private enqueuePost(event: WebhookEvent) {
    const log = this.options.log;

    if (this.pendingPosts >= maxPendingPosts) {
      log.warn("send queue full, dropping", { messageId: event.message_id });

      return;
    }

    this.pendingPosts++;
    this.posts = this.posts
      .then(async () => {
        try {
          await this.post(event);

          log.info("forwarded", {
            messageId: event.message_id,
            channelId: event.channel_id,
            trigger: event.trigger,
            authorId: event.author.id,
          });
        } catch (err) {
          log.error("webhook post failed", {
            messageId: event.message_id,
            channelId: event.channel_id,
            err,
          });
        }
      })
      .finally(() => {
        this.pendingPosts--;
      });
  }

  // One try, no retry.
  async post(event: WebhookEvent): Promise<void> {
    const res = await this.doFetch(this.options.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.options.webhookAuthHeader,
        "User-Agent": "grok-dc-notifier",
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(this.options.webhookTimeoutMs),
    });

    await res.body?.cancel();

    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }
  }
}

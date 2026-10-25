import {
  type Channel,
  isThread,
  type Message,
  type ReferencedMessage,
} from "../discord/schemas.ts";

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

const authorOf = (message: Message | ReferencedMessage): Author => ({
  id: message.author.id,
  username: message.author.username ?? "",
});

const describeReply = (reply: ReferencedMessage) => ({
  message_id: reply.id,
  author: authorOf(reply),
  content: reply.content ?? "",
  timestamp: reply.timestamp,
});

export function toWebhookEvent(
  message: Message,
  trigger: Trigger,
  channel: Channel | undefined,
): WebhookEvent {
  const thread = isThread(channel) ? channel : undefined;
  const reply = message.referenced_message;

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
    ...(reply ? { referenced_message: describeReply(reply) } : {}),
  };
}

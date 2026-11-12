import { z } from "zod";
import {
  type Channel,
  channelSchema,
  type Message,
  messageSchema,
} from "./schemas.ts";

export class NotFoundError extends Error {
  constructor(
    path: string,
    readonly status = 404,
  ) {
    super(`not found: ${path}`);
  }
}

export class DiscordRequestError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: string | null,
  ) {
    super(`Discord request failed with status ${status}`);
  }
}

export interface DiscordApi {
  channel(id: string): Promise<Channel>;
  message(channelId: string, messageId: string): Promise<Message>;
  messages(channelId: string, limit: number): Promise<Message[]>;
}

export interface RestClientOptions {
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const maxRateLimitRetries = 2;
const maxHonoredRetryAfterSeconds = 30;
const defaultRetryDelayMs = 1_000;
const userAgent =
  "DiscordBot (https://github.com/VaynerAkaWalo/grok-dc-notifier, 1)";

export class DiscordRestClient implements DiscordApi {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: RestClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://discord.com/api/v10";
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetch = options.fetch ?? fetch;
  }

  channel(channelId: string): Promise<Channel> {
    return this.execute(
      `/channels/${encodeURIComponent(channelId)}`,
      channelSchema,
    );
  }

  message(channelId: string, messageId: string): Promise<Message> {
    return this.execute(
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
      messageSchema,
    );
  }

  messages(channelId: string, limit: number): Promise<Message[]> {
    return this.execute(
      `/channels/${encodeURIComponent(channelId)}/messages?limit=${limit}`,
      messageSchema.array(),
    );
  }

  relayMessage(channelId: string, messageId: string) {
    return this.execute(
      `/channels/${channelId}/messages/${messageId}`,
      messageSchema.loose(),
    );
  }

  relayMessages(channelId: string, query: URLSearchParams) {
    return this.execute(
      `/channels/${channelId}/messages?${query}`,
      messageSchema.loose().array(),
    );
  }

  createThread(
    channelId: string,
    messageId: string,
    body: { name: string; auto_archive_duration?: number },
  ) {
    return this.execute(
      `/channels/${channelId}/messages/${messageId}/threads`,
      channelSchema.loose(),
      "POST",
      body,
    );
  }

  postMessage(channelId: string, content: string, replyTo?: string) {
    return this.execute(
      `/channels/${channelId}/messages`,
      messageSchema.loose(),
      "POST",
      {
        content,
        allowed_mentions: { parse: [], replied_user: false },
        ...(replyTo
          ? {
              message_reference: {
                message_id: replyTo,
                channel_id: channelId,
                fail_if_not_exists: true,
              },
            }
          : {}),
      },
    );
  }

  addReaction(channelId: string, messageId: string, emoji: string) {
    return this.execute(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
      z.undefined(),
      "PUT",
    );
  }

  private async execute<T>(
    path: string,
    schema: z.ZodType<T>,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.request(path, method, body);

      if (res.status === 429 && attempt < maxRateLimitRetries) {
        await res.body?.cancel();
        await Bun.sleep(this.retryDelayMs(res));

        continue;
      }

      if (res.status === 404 || res.status === 403) {
        await res.body?.cancel();

        throw new NotFoundError(path, res.status);
      }

      if (!res.ok) {
        await res.body?.cancel();

        throw new DiscordRequestError(
          res.status,
          res.headers.get("retry-after"),
        );
      }

      const parsed = schema.safeParse(
        res.status === 204 ? undefined : await res.json(),
      );

      if (!parsed.success) {
        throw new Error(`${method} ${path}: unexpected response shape`);
      }

      return parsed.data;
    }
  }

  private request(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<Response> {
    return this.fetch(this.baseUrl + path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${this.options.token}`,
        "User-Agent": userAgent,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private retryDelayMs(res: Response): number {
    const retryAfterSeconds = Number(res.headers.get("retry-after"));

    return retryAfterSeconds > 0 &&
      retryAfterSeconds < maxHonoredRetryAfterSeconds
      ? retryAfterSeconds * 1000
      : defaultRetryDelayMs;
  }
}

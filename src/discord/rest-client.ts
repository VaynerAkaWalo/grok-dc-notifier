import type { z } from "zod";
import {
  type Channel,
  channelSchema,
  type Message,
  messageSchema,
} from "./schemas.ts";

export class NotFoundError extends Error {
  constructor(path: string) {
    super(`not found: ${path}`);
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
    return this.get(
      `/channels/${encodeURIComponent(channelId)}`,
      channelSchema,
    );
  }

  message(channelId: string, messageId: string): Promise<Message> {
    return this.get(
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
      messageSchema,
    );
  }

  messages(channelId: string, limit: number): Promise<Message[]> {
    return this.get(
      `/channels/${encodeURIComponent(channelId)}/messages?limit=${limit}`,
      messageSchema.array(),
    );
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.request(path);

      if (res.status === 429 && attempt < maxRateLimitRetries) {
        await res.body?.cancel();
        await Bun.sleep(this.retryDelayMs(res));

        continue;
      }

      if (res.status === 404 || res.status === 403) {
        await res.body?.cancel();

        throw new NotFoundError(path);
      }

      if (!res.ok) {
        await res.body?.cancel();

        throw new Error(`GET ${path}: status ${res.status}`);
      }

      const parsed = schema.safeParse(await res.json());

      if (!parsed.success) {
        throw new Error(`GET ${path}: unexpected response shape`);
      }

      return parsed.data;
    }
  }

  private request(path: string): Promise<Response> {
    return this.fetch(this.baseUrl + path, {
      headers: {
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

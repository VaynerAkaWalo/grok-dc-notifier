import type { Channel, Message } from "./types.ts";

// Returned for 404 and 403 (no access) responses.
export class NotFoundError extends Error {
  constructor(path: string) {
    super(`not found: ${path}`);
  }
}

// The REST lookups used after a cache miss.
export interface DiscordApi {
  channel(id: string): Promise<Channel>;
  message(channelId: string, messageId: string): Promise<Message>;
  messages(channelId: string, limit: number): Promise<Message[]>;
}

export interface RestOptions {
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function createRest(options: RestOptions): DiscordApi {
  const baseUrl = options.baseUrl ?? "https://discord.com/api/v10";
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const get = async <T>(path: string): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(baseUrl + path, {
        headers: {
          Authorization: `Bot ${options.token}`,
          "User-Agent":
            "DiscordBot (https://github.com/VaynerAkaWalo/grok-dc-notifier, 1)",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.status === 429 && attempt < 2) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs =
          retryAfter > 0 && retryAfter < 30 ? retryAfter * 1000 : 1000;

        await res.body?.cancel();
        await Bun.sleep(waitMs);

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

      return (await res.json()) as T;
    }
  };

  const id = encodeURIComponent;

  return {
    channel: (channelId) => get(`/channels/${id(channelId)}`),
    message: (channelId, messageId) =>
      get(`/channels/${id(channelId)}/messages/${id(messageId)}`),
    messages: (channelId, limit) =>
      get(`/channels/${id(channelId)}/messages?limit=${limit}`),
  };
}

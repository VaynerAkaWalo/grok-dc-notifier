import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  DiscordRequestError,
  type DiscordRestClient,
  NotFoundError,
} from "../discord/rest-client.ts";

const guildId = "1561814224538304512";
const snowflake = z.string().regex(/^[1-9]\d{0,19}$/);
const messageBody = z.strictObject({
  content: z.string().min(1).max(2000),
  reply_to: snowflake.optional(),
});
const threadBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  auto_archive_duration: z
    .union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)])
    .optional(),
});
const historyQuery = z.strictObject({
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional(),
  before: snowflake.optional(),
});

class InvalidBodyError extends Error {}

async function readBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new InvalidBodyError();
  }
}

type RelayDiscord = Pick<
  DiscordRestClient,
  | "channel"
  | "relayMessage"
  | "relayMessages"
  | "createThread"
  | "postMessage"
  | "addReaction"
>;

export class RelayApi {
  constructor(
    private readonly api: RelayDiscord,
    private readonly token?: string,
  ) {}

  handle = async (req: Request): Promise<Response> => {
    if (!this.token)
      return Response.json({ error: "relay API disabled" }, { status: 503 });

    const supplied = Buffer.from(req.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${this.token}`);

    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return Response.json(
        { error: "unauthorized" },
        { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
      );
    }

    try {
      return await this.route(req);
    } catch (error) {
      if (
        error instanceof z.ZodError ||
        error instanceof InvalidBodyError ||
        error instanceof URIError
      ) {
        return Response.json({ error: "invalid request" }, { status: 400 });
      }

      if (error instanceof NotFoundError) {
        return Response.json(
          { error: "Discord resource unavailable" },
          { status: error.status },
        );
      }

      if (
        error instanceof DiscordRequestError &&
        [400, 429].includes(error.status)
      ) {
        const headers = new Headers();
        if (error.status === 429 && error.retryAfter)
          headers.set("Retry-After", error.retryAfter);

        return Response.json(
          { error: "Discord rejected request" },
          { status: error.status, headers },
        );
      }

      return Response.json({ error: "Discord unavailable" }, { status: 502 });
    }
  };

  private async route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const match =
      /^\/api\/channels\/([^/]+)\/messages(?:\/([^/]+)(?:\/(threads|reactions)(?:\/([^/]+))?)?)?$/.exec(
        url.pathname,
      );
    if (!match) return Response.json({ error: "not found" }, { status: 404 });

    const channelId = snowflake.parse(match[1]);
    const messageId =
      match[2] === undefined ? undefined : snowflake.parse(match[2]);
    const action = match[3];
    const emoji = match[4];
    const history = req.method === "GET" && !action;
    const post = req.method === "POST" && !action && !messageId;
    const thread = req.method === "POST" && action === "threads" && !emoji;
    const reaction =
      req.method === "PUT" && action === "reactions" && emoji !== undefined;

    if (!history && !post && !thread && !reaction) {
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }

    const channel = await this.api.channel(channelId);
    if (channel.guild_id !== guildId)
      return Response.json({ error: "guild forbidden" }, { status: 403 });

    if (history) {
      if (messageId)
        return Response.json(await this.api.relayMessage(channelId, messageId));

      const query = historyQuery.parse(Object.fromEntries(url.searchParams));
      const params = new URLSearchParams({ limit: String(query.limit ?? 50) });
      if (query.before) params.set("before", query.before);

      return Response.json(await this.api.relayMessages(channelId, params));
    }

    if (post) {
      const body = messageBody.parse(await readBody(req));

      return Response.json(
        await this.api.postMessage(channelId, body.content, body.reply_to),
        { status: 201 },
      );
    }

    if (thread && messageId) {
      const body = threadBody.parse(await readBody(req));

      return Response.json(
        await this.api.createThread(channelId, messageId, body),
        { status: 201 },
      );
    }

    if (reaction && messageId && emoji) {
      const decoded = z
        .string()
        .min(1)
        .max(128)
        .parse(decodeURIComponent(emoji));
      await this.api.addReaction(channelId, messageId, decoded);

      return new Response(null, { status: 204 });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  }
}

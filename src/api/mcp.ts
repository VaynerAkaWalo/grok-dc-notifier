import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  type DiscordRelayService,
  GuildForbiddenError,
} from "../discord/relay-service.ts";
import { DiscordRequestError, NotFoundError } from "../discord/rest-client.ts";

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

function describeFailure(error: unknown): string {
  if (error instanceof GuildForbiddenError) return "guild forbidden";
  if (error instanceof NotFoundError) return "Discord resource unavailable";
  if (
    error instanceof DiscordRequestError &&
    [400, 429].includes(error.status)
  ) {
    return "Discord rejected request";
  }

  return "Discord unavailable";
}

async function toToolResult(operation: () => Promise<unknown>) {
  try {
    const result = await operation();

    return {
      isError: false,
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: describeFailure(error) }),
        },
      ],
    };
  }
}

export class RelayMcp {
  constructor(
    private readonly relay: DiscordRelayService,
    private readonly token?: string,
  ) {}

  handle = async (req: Request): Promise<Response> => {
    const unauthorized = this.authorize(req);
    if (unauthorized) return unauthorized;

    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin)
      return Response.json({ error: "origin forbidden" }, { status: 403 });

    if (req.method !== "POST")
      return new Response(null, { status: 405, headers: { Allow: "POST" } });

    const server = this.createServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      maxRequestBodySize: 16_384,
    });

    await server.connect(transport);

    try {
      return await transport.handleRequest(req);
    } finally {
      await server.close();
    }
  };

  private authorize(req: Request): Response | undefined {
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
  }

  private createServer(): McpServer {
    const server = new McpServer({
      name: "grok-dc-notifier",
      version: "1.0.0",
    });

    server.registerTool(
      "create_thread",
      {
        description:
          "Create a thread from an existing message in the allowed guild.",
        inputSchema: threadBody.extend({
          channel: snowflake,
          message: snowflake,
        }),
      },
      ({ channel, message, ...body }) =>
        toToolResult(() => this.relay.createThread(channel, message, body)),
    );
    server.registerTool(
      "post_message",
      {
        description:
          "Post a message or reply with all mention notifications disabled.",
        inputSchema: messageBody.extend({ channel: snowflake }),
      },
      ({ channel, content, reply_to }) =>
        toToolResult(() => this.relay.postMessage(channel, content, reply_to)),
    );
    server.registerTool(
      "list_messages",
      {
        description:
          "Read newest-first messages including embeds from the allowed guild.",
        inputSchema: z.strictObject({
          channel: snowflake,
          limit: z.number().int().min(1).max(100).optional(),
          before: snowflake.optional(),
        }),
      },
      ({ channel, limit, before }) =>
        toToolResult(() => this.relay.listMessages(channel, limit, before)),
    );
    server.registerTool(
      "get_message",
      {
        description:
          "Read one message including embeds from the allowed guild.",
        inputSchema: z.strictObject({ channel: snowflake, message: snowflake }),
      },
      ({ channel, message }) =>
        toToolResult(() => this.relay.getMessage(channel, message)),
    );
    server.registerTool(
      "add_reaction",
      {
        description:
          "Add a Unicode or name:id custom emoji reaction in the allowed guild.",
        inputSchema: z.strictObject({
          channel: snowflake,
          message: snowflake,
          emoji: z.string().min(1).max(128),
        }),
      },
      ({ channel, message, emoji }) =>
        toToolResult(async () => {
          await this.relay.addReaction(channel, message, emoji);

          return { ok: true };
        }),
    );

    return server;
  }
}

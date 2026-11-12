import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  messageBody,
  type RelayApi,
  snowflake,
  threadBody,
} from "./handler.ts";

export class RelayMcp {
  constructor(private readonly api: RelayApi) {}

  handle = async (req: Request): Promise<Response> => {
    const unauthorized = this.api.authorize(req);
    if (unauthorized) return unauthorized;

    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin)
      return Response.json({ error: "origin forbidden" }, { status: 403 });

    if (req.method !== "POST")
      return new Response(null, { status: 405, headers: { Allow: "POST" } });

    const server = new McpServer({
      name: "grok-dc-notifier",
      version: "1.0.0",
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      maxRequestBodySize: 16_384,
    });
    const headers = new Headers({
      authorization: req.headers.get("authorization") ?? "",
      "content-type": "application/json",
    });
    const invoke = async (method: string, path: string, body?: unknown) => {
      const response = await this.api.handle(
        new Request(new URL(path, req.url).href, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      const result =
        response.status === 204 ? { ok: true } : await response.json();

      return {
        isError: !response.ok,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    };

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
        invoke(
          "POST",
          `/api/channels/${channel}/messages/${message}/threads`,
          body,
        ),
    );
    server.registerTool(
      "post_message",
      {
        description:
          "Post a message or reply with all mention notifications disabled.",
        inputSchema: messageBody.extend({ channel: snowflake }),
      },
      ({ channel, ...body }) =>
        invoke("POST", `/api/channels/${channel}/messages`, body),
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
      ({ channel, limit, before }) => {
        const query = new URLSearchParams();
        if (limit !== undefined) query.set("limit", String(limit));
        if (before) query.set("before", before);

        return invoke("GET", `/api/channels/${channel}/messages?${query}`);
      },
    );
    server.registerTool(
      "get_message",
      {
        description:
          "Read one message including embeds from the allowed guild.",
        inputSchema: z.strictObject({ channel: snowflake, message: snowflake }),
      },
      ({ channel, message }) =>
        invoke("GET", `/api/channels/${channel}/messages/${message}`),
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
        invoke(
          "PUT",
          `/api/channels/${channel}/messages/${message}/reactions/${encodeURIComponent(emoji)}`,
        ),
    );

    await server.connect(transport);

    try {
      return await transport.handleRequest(req);
    } finally {
      await server.close();
    }
  };
}

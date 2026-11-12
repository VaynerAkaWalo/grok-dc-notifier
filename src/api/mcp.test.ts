import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DiscordRelayService } from "../discord/relay-service.ts";
import { DiscordRestClient } from "../discord/rest-client.ts";
import { RelayMcp } from "./mcp.ts";

const token = "relay-test-token-with-at-least-32-characters";
const guild = "1561814224538304512";
const message = {
  id: "22",
  channel_id: "11",
  author: { id: "33" },
  content: "hello",
  embeds: [{ title: "embed" }],
};
const cleanup: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function setup(
  options: {
    guild?: string | null;
    token?: string | null;
    fail?: boolean;
    writeStatus?: number;
  } = {},
) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const discord = new DiscordRestClient({
    token: "discord-test-token",
    baseUrl: "https://discord.test",
    fetch: (async (input, init) => {
      const path = String(input);
      calls.push({
        path,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      if (options.fail) throw new Error("secret upstream details");
      if (path.endsWith("/channels/11"))
        return Response.json({
          id: "11",
          type: 11,
          guild_id: options.guild === undefined ? guild : options.guild,
        });
      if (options.writeStatus && init?.method !== "GET")
        return new Response(null, { status: options.writeStatus });
      if (path.endsWith("/@me")) return new Response(null, { status: 204 });
      if (path.endsWith("/threads"))
        return Response.json({ id: "44", type: 11, guild_id: guild });

      return Response.json(
        init?.method === "GET" && !path.endsWith("/22") ? [message] : message,
      );
    }) as typeof fetch,
  });
  const mcp = new RelayMcp(
    new DiscordRelayService(discord),
    options.token === null ? undefined : token,
  );
  const server = Bun.serve({ port: 0, fetch: mcp.handle });
  cleanup.push(() => server.stop(true));

  return { calls, url: new URL("/api/mcp", server.url) };
}

async function connect(url: URL) {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  cleanup.push(() => client.close());

  return client;
}

const tools = [
  [
    "create_thread",
    {
      channel: "11",
      message: "22",
      name: "discussion",
      auto_archive_duration: 1440,
    },
    "POST",
    "/channels/11/messages/22/threads",
  ],
  [
    "post_message",
    { channel: "11", content: "@everyone @here <@33> <@&44>", reply_to: "22" },
    "POST",
    "/channels/11/messages",
  ],
  [
    "list_messages",
    { channel: "11", limit: 10, before: "99" },
    "GET",
    "/channels/11/messages?limit=10&before=99",
  ],
  [
    "get_message",
    { channel: "11", message: "22" },
    "GET",
    "/channels/11/messages/22",
  ],
  [
    "add_reaction",
    { channel: "11", message: "22", emoji: "custom:123" },
    "PUT",
    "/channels/11/messages/22/reactions/custom%3A123/@me",
  ],
] as const;

describe("Streamable HTTP MCP", () => {
  test("initializes and advertises exactly the five relay tools without channel creation or deletion", async () => {
    const { url, calls } = setup();
    const client = await connect(url);

    const result = await client.listTools();

    expect(result.tools.map((tool) => tool.name).sort()).toEqual(
      tools.map(([name]) => name).sort(),
    );
    expect(calls).toHaveLength(0);
  });

  for (const [name, args, method, path] of tools) {
    test(`${name} invokes the existing relay operation`, async () => {
      const { url, calls } = setup();
      const client = await connect(url);

      const result = await client.callTool({ name, arguments: args });

      expect(result.isError).toBe(false);
      expect(calls[1]).toMatchObject({
        method,
        path: `https://discord.test${path}`,
      });
      if (name === "post_message")
        expect(calls[1]?.body).toEqual({
          content: args.content,
          allowed_mentions: { parse: [], replied_user: false },
          message_reference: {
            message_id: "22",
            channel_id: "11",
            fail_if_not_exists: true,
          },
        });
      if (name === "create_thread")
        expect(calls[1]?.body).toEqual({
          name: "discussion",
          auto_archive_duration: 1440,
        });
      if (name === "list_messages" || name === "get_message")
        expect(JSON.stringify(result.content)).toContain("embed");
      if (name === "add_reaction")
        expect(result.content).toEqual([{ type: "text", text: '{"ok":true}' }]);
    });

    for (const foreignGuild of ["999", null]) {
      test(`${name} rejects foreign guilds and DMs with guild ${foreignGuild}`, async () => {
        const { url, calls } = setup({ guild: foreignGuild });
        const client = await connect(url);

        const result = await client.callTool({ name, arguments: args });

        expect(result.isError).toBe(true);
        expect(result.content).toEqual([
          { type: "text", text: '{"error":"guild forbidden"}' },
        ]);
        expect(calls).toHaveLength(1);
      });
    }
  }

  for (const method of ["POST", "GET", "DELETE"]) {
    test(`${method} rejects missing and incorrect credentials before processing`, async () => {
      const { url, calls } = setup();

      for (const authorization of ["", "Bearer wrong", "Basic wrong"]) {
        const response = await fetch(url, {
          method,
          headers: { authorization },
          body: method === "POST" ? "invalid JSON" : undefined,
        });

        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toBe("Bearer");
      }

      expect(calls).toHaveLength(0);
    });
  }

  test("an unset token disables MCP", async () => {
    const { url, calls } = setup({ token: null });

    const response = await fetch(url, { method: "POST" });

    expect(response.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  for (const [name, args] of [
    [
      "post_message",
      {
        channel: "11",
        content: "hello",
        allowed_mentions: { parse: ["everyone"] },
      },
    ],
    ["post_message", { channel: "../11", content: "hello" }],
    ["post_message", { channel: "11", content: "" }],
    ["post_message", { channel: "11", content: "x".repeat(2001) }],
    ["create_thread", { channel: "11", message: "22", name: " " }],
    [
      "create_thread",
      {
        channel: "11",
        message: "22",
        name: "thread",
        auto_archive_duration: 1,
      },
    ],
    ["list_messages", { channel: "11", limit: 101 }],
    ["get_message", { channel: "11", message: "../22" }],
    ["add_reaction", { channel: "11", message: "22", emoji: "" }],
    ["create_channel", { name: "channel" }],
    ["delete_channel", { channel: "11" }],
  ] as const) {
    test(`rejects unsafe or unsupported ${name} input ${JSON.stringify(args).slice(0, 100)}`, async () => {
      const { url, calls } = setup();
      const client = await connect(url);

      const result = await client.callTool({ name, arguments: args });

      expect(result.isError).toBe(true);
      expect(calls).toHaveLength(0);
    });
  }

  test("does not expose upstream error details", async () => {
    const { url } = setup({ fail: true });
    const client = await connect(url);

    const result = await client.callTool({
      name: "get_message",
      arguments: { channel: "11", message: "22" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: '{"error":"Discord unavailable"}' },
    ]);
  });

  for (const [status, error] of [
    [400, "Discord rejected request"],
    [429, "Discord rejected request"],
    [403, "Discord resource unavailable"],
    [404, "Discord resource unavailable"],
    [500, "Discord unavailable"],
  ] as const) {
    test(`maps Discord write status ${status} to ${error}`, async () => {
      const { url } = setup({ writeStatus: status });
      const client = await connect(url);

      const result = await client.callTool({
        name: "post_message",
        arguments: { channel: "11", content: "hello" },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify({ error }) },
      ]);
    });
  }

  test("a Discord write failure is not retried after possible partial success", async () => {
    const { url, calls } = setup({ writeStatus: 500 });
    const client = await connect(url);

    await client.callTool({
      name: "post_message",
      arguments: { channel: "11", content: "hello" },
    });

    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  test("rejects cross-origin requests before Discord operations", async () => {
    const { url, calls } = setup();

    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        origin: "https://untrusted.test",
      },
    });

    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  test("bounds MCP request bodies and rejects malformed JSON", async () => {
    const { url, calls } = setup();
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };

    const oversized = await fetch(url, {
      method: "POST",
      headers,
      body: "x".repeat(16_385),
    });
    const malformed = await fetch(url, { method: "POST", headers, body: "{" });

    expect(oversized.status).toBe(413);
    expect(malformed.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

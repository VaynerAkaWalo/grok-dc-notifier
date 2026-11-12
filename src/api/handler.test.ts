import { describe, expect, test } from "bun:test";
import { DiscordRestClient } from "../discord/rest-client.ts";
import { RelayApi } from "./handler.ts";

const token = "relay-test-token-with-at-least-32-characters";
const guild = "1561814224538304512";
const message = {
  id: "22",
  channel_id: "11",
  author: { id: "33" },
  content: "hello",
  embeds: [{ title: "An embed", fields: [{ name: "x", value: "y" }] }],
};
const routes = [
  ["POST", "/api/channels/11/messages/22/threads", { name: "thread" }],
  ["POST", "/api/channels/11/messages", { content: "hello" }],
  ["GET", "/api/channels/11/messages", undefined],
  ["GET", "/api/channels/11/messages/22", undefined],
  ["PUT", "/api/channels/11/messages/22/reactions/%F0%9F%91%8D", undefined],
] as const;

function setup(
  options: {
    guild?: string | null;
    status?: number;
    mutationStatus?: number;
    response?: unknown;
    malformed?: boolean;
    fail?: boolean;
  } = {},
) {
  const calls: {
    path: string;
    method: string;
    body: unknown;
    authorization: string | null;
  }[] = [];
  const client = new DiscordRestClient({
    token: "discord-test-token",
    baseUrl: "https://discord.test",
    fetch: (async (input, init) => {
      const path = new URL(String(input)).pathname;
      calls.push({
        path: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        authorization: new Headers(init?.headers).get("authorization"),
      });

      if (options.fail)
        throw new Error("network failure containing credentials");
      if (options.status) return new Response(null, { status: options.status });
      if (path === "/channels/11")
        return Response.json({
          id: "11",
          type: 11,
          guild_id: options.guild === undefined ? guild : options.guild,
        });
      if (options.mutationStatus)
        return new Response(null, {
          status: options.mutationStatus,
          headers: { "Retry-After": "0.001" },
        });
      if (options.malformed) return new Response("not JSON");
      if (options.response !== undefined)
        return Response.json(options.response);
      if (path.endsWith("/@me")) return new Response(null, { status: 204 });
      if (path.endsWith("/threads"))
        return Response.json({ id: "22", guild_id: guild, type: 11 });

      return Response.json(
        path.endsWith("/messages") && init?.method === "GET"
          ? [message]
          : message,
      );
    }) as typeof fetch,
  });

  return { api: new RelayApi(client, token), calls };
}

function request(
  method: string,
  path: string,
  body?: unknown,
  authorization: string | null = `Bearer ${token}`,
) {
  const headers = new Headers();
  if (authorization !== null) headers.set("authorization", authorization);

  return new Request(`http://relay.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("relay API", () => {
  for (const [method, path, body] of routes) {
    test(`${method} ${path} requires the relay bearer token before calling Discord`, async () => {
      const { api, calls } = setup();

      for (const authorization of [null, "Bearer wrong", "Basic wrong"]) {
        const response = await api.handle(
          request(method, path, body, authorization),
        );

        expect(response.status).toBe(401);
      }

      expect(calls).toHaveLength(0);
    });

    for (const foreignGuild of ["999", null]) {
      test(`${method} ${path} rejects channels outside BLAME DEVS including DMs with guild ${foreignGuild}`, async () => {
        const { api, calls } = setup({ guild: foreignGuild });

        const response = await api.handle(request(method, path, body));

        expect(response.status).toBe(403);
        expect(calls).toHaveLength(1);
      });
    }
  }

  test("an unset relay token disables the API", async () => {
    const { calls } = setup();
    const api = new RelayApi({} as DiscordRestClient);

    const response = await api.handle(
      request("GET", "/api/channels/11/messages"),
    );

    expect(response.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  test("posts replies into guild threads without notifying everyone, here, roles, users or the replied author", async () => {
    const { api, calls } = setup();

    const response = await api.handle(
      request("POST", "/api/channels/11/messages", {
        content: "@everyone @here <@33> <@&44>",
        reply_to: "22",
      }),
    );

    expect(response.status).toBe(201);
    expect(calls[1]).toMatchObject({
      method: "POST",
      authorization: "Bot discord-test-token",
      body: {
        content: "@everyone @here <@33> <@&44>",
        allowed_mentions: { parse: [], replied_user: false },
        message_reference: {
          message_id: "22",
          channel_id: "11",
          fail_if_not_exists: true,
        },
      },
    });
    expect(await response.json()).toEqual(message);
  });

  test("posts a message without a reply reference", async () => {
    const { api, calls } = setup();

    const response = await api.handle(
      request("POST", "/api/channels/11/messages", { content: "hello" }),
    );

    expect(response.status).toBe(201);
    expect(calls[1]?.body).toEqual({
      content: "hello",
      allowed_mentions: { parse: [], replied_user: false },
    });
  });

  test("creates a thread from an existing message", async () => {
    const { api, calls } = setup();

    const response = await api.handle(
      request("POST", "/api/channels/11/messages/22/threads", {
        name: "discussion",
        auto_archive_duration: 1440,
      }),
    );

    expect(response.status).toBe(201);
    expect(calls[1]).toMatchObject({
      path: "https://discord.test/channels/11/messages/22/threads",
      method: "POST",
      body: { name: "discussion", auto_archive_duration: 1440 },
    });
    expect(await response.json()).toMatchObject({ id: "22" });
  });

  test("reads history with embeds and pagination", async () => {
    const { api, calls } = setup();

    const response = await api.handle(
      request("GET", "/api/channels/11/messages?limit=10&before=99"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([message]);
    expect(calls[1]?.path).toBe(
      "https://discord.test/channels/11/messages?limit=10&before=99",
    );
  });

  test("reads a single message including embeds", async () => {
    const { api } = setup();

    const response = await api.handle(
      request("GET", "/api/channels/11/messages/22"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(message);
  });

  for (const emoji of ["👍", "custom:123"]) {
    test(`adds a reaction with encoded emoji ${emoji}`, async () => {
      const { api, calls } = setup();

      const response = await api.handle(
        request(
          "PUT",
          `/api/channels/11/messages/22/reactions/${encodeURIComponent(emoji)}`,
        ),
      );

      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      expect(calls[1]).toMatchObject({
        method: "PUT",
        path: `https://discord.test/channels/11/messages/22/reactions/${encodeURIComponent(emoji)}/@me`,
      });
    });
  }

  for (const [method, path, body] of [
    [
      "POST",
      "/api/channels/11/messages",
      { content: "hello", allowed_mentions: { parse: ["everyone"] } },
    ],
    ["POST", "/api/channels/11/messages", { content: "" }],
    ["POST", "/api/channels/11/messages", { content: "x".repeat(2001) }],
    [
      "POST",
      "/api/channels/11/messages",
      { content: "hello", reply_to: "../22" },
    ],
    ["POST", "/api/channels/11/messages/22/threads", { name: " " }],
    [
      "POST",
      "/api/channels/11/messages/22/threads",
      { name: "thread", auto_archive_duration: 1 },
    ],
    ["GET", "/api/channels/11/messages?limit=101", undefined],
    ["GET", "/api/channels/11/messages?before=bad", undefined],
    ["GET", "/api/channels/11/messages?after=99", undefined],
    ["GET", "/api/channels/abc/messages", undefined],
    ["PUT", "/api/channels/11/messages/22/reactions/%ZZ", undefined],
  ] as const) {
    test(`rejects invalid input ${method} ${path} ${JSON.stringify(body)}`, async () => {
      const { api, calls } = setup();

      const response = await api.handle(request(method, path, body));

      expect(response.status).toBe(400);
      expect(calls.length).toBeLessThanOrEqual(1);
    });
  }

  test("rejects malformed JSON without writing to Discord", async () => {
    const { api, calls } = setup();
    const req = new Request("http://relay.test/api/channels/11/messages", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "{",
    });

    const response = await api.handle(req);

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  for (const status of [400, 403, 404, 500, 401]) {
    test(`maps Discord status ${status} without disclosing credentials`, async () => {
      const { api } = setup({ status });

      const response = await api.handle(
        request("GET", "/api/channels/11/messages"),
      );

      expect(response.status).toBe(
        status >= 500 || status === 401 ? 502 : status,
      );
      expect(await response.text()).not.toContain("token");
    });
  }

  for (const options of [
    { malformed: true },
    { response: { bad: true } },
    { fail: true },
  ]) {
    test(`upstream failures are gateway errors ${JSON.stringify(options)}`, async () => {
      const { api } = setup(options);

      const response = await api.handle(
        request("GET", "/api/channels/11/messages"),
      );

      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain("credentials");
    });
  }

  test("exhausted Discord rate limits retain Retry-After and bound write attempts", async () => {
    const { api, calls } = setup({ mutationStatus: 429 });

    const response = await api.handle(
      request("POST", "/api/channels/11/messages", { content: "hello" }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("0.001");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(3);
  });

  test("a Discord write failure is not retried after possible partial success", async () => {
    const { api, calls } = setup({ mutationStatus: 500 });

    const response = await api.handle(
      request("POST", "/api/channels/11/messages", { content: "hello" }),
    );

    expect(response.status).toBe(502);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  test("does not expose channel creation, deletion or arbitrary Discord paths", async () => {
    const { api, calls } = setup();

    expect((await api.handle(request("POST", "/api/channels"))).status).toBe(
      404,
    );
    expect(
      (await api.handle(request("DELETE", "/api/channels/11/messages/22")))
        .status,
    ).toBe(405);
    expect((await api.handle(request("GET", "/api/guilds/99"))).status).toBe(
      404,
    );
    expect(calls).toHaveLength(0);
  });
});

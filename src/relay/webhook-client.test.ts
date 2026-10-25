import { afterAll, expect, test } from "bun:test";
import { WebhookClient } from "./webhook-client.ts";
import { toWebhookEvent } from "./webhook-event.ts";

let seen:
  | { auth: string | null; type: string | null; body: unknown }
  | undefined;

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    seen = {
      auth: req.headers.get("authorization"),
      type: req.headers.get("content-type"),
      body: await req.json(),
    };

    return new URL(req.url).pathname === "/fail"
      ? new Response("nope", { status: 500 })
      : new Response("ok");
  },
});

afterAll(() => server.stop(true));

const event = toWebhookEvent(
  {
    id: "42",
    channel_id: "t",
    guild_id: "111",
    content: "hej",
    timestamp: "2026-01-01T00:00:00Z",
    author: { id: "1", username: "user1" },
    referenced_message: {
      id: "41",
      channel_id: "t",
      author: { id: "999" },
      content: "prev",
    },
  },
  "engaged_thread",
  { id: "t", type: 11, parent_id: "100" },
);

test("posts the event with the configured Authorization header", async () => {
  const webhook = new WebhookClient({
    url: server.url.href,
    authHeader: "Bearer secret",
    timeoutMs: 1_000,
  });

  await webhook.send(event);

  expect(seen?.auth).toBe("Bearer secret");
  expect(seen?.type).toBe("application/json");
  expect(seen?.body).toEqual({
    trigger: "engaged_thread",
    guild_id: "111",
    channel_id: "t",
    thread_id: "t",
    parent_id: "100",
    message_id: "42",
    author: { id: "1", username: "user1" },
    content: "hej",
    timestamp: "2026-01-01T00:00:00Z",
    referenced_message: {
      message_id: "41",
      author: { id: "999", username: "" },
      content: "prev",
    },
  });
});

test("fails on a non-2xx response", async () => {
  const webhook = new WebhookClient({
    url: new URL("/fail", server.url).href,
    authHeader: "Bearer secret",
    timeoutMs: 1_000,
  });

  expect(webhook.send(event)).rejects.toThrow("status 500");
});

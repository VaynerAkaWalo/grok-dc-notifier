import { describe, expect, test } from "bun:test";
import { type DiscordApi, NotFoundError } from "../discord/rest-client.ts";
import type { Channel, Message } from "../discord/schemas.ts";
import { createLogger, silentLogger } from "../infra/logger.ts";
import { createRelay } from "./create-relay.ts";
import { Dedupe } from "./dedupe.ts";
import { RateLimiter } from "./rate-limiter.ts";
import type { WebhookEvent } from "./webhook-event.ts";

const bot = "999";
const alice = "1";
const guild = "111111111111111111";
const general = "100";
const botRole = "700";

class FakeApi implements DiscordApi {
  calls = 0;

  constructor(
    readonly channels: Record<string, Channel> = {},
    readonly starters: Record<string, Message> = {},
    readonly history: Record<string, Message[]> = {},
  ) {}

  async channel(id: string) {
    this.calls++;

    const channel = this.channels[id];

    if (!channel) {
      throw new NotFoundError(id);
    }

    return channel;
  }

  async message(channelId: string, messageId: string) {
    this.calls++;

    const message = this.starters[`${channelId}/${messageId}`];

    if (!message) {
      throw new NotFoundError(messageId);
    }

    return message;
  }

  async messages(channelId: string) {
    this.calls++;

    return this.history[channelId] ?? [];
  }
}

function setup(api = new FakeApi(), perMinute = 100) {
  const posted: WebhookEvent[] = [];
  const relay = createRelay({
    allowedUserIds: new Set([alice, "2"]),
    allowedGuildIds: new Set([guild]),
    api,
    dedupe: new Dedupe(60_000),
    limiter: new RateLimiter(perMinute),
    negativeTtlMs: 30 * 60_000,
    webhook: { send: async (event) => void posted.push(event) },
    log: silentLogger,
  });

  const send = async (type: string, data: unknown) => {
    relay.handle(type, data, bot);
    await relay.idle();
  };

  const forwarded = async (data: Partial<Message> & { id: string }) => {
    const before = posted.length;

    await send("MESSAGE_CREATE", data);

    return posted.length > before ? posted.at(-1) : undefined;
  };

  return { relay, api, posted, send, forwarded };
}

async function withGuild(api = new FakeApi(), perMinute = 100) {
  const env = setup(api, perMinute);

  await env.send("GUILD_CREATE", {
    id: guild,
    roles: [{ id: botRole, tags: { bot_id: bot } }, { id: "701" }],
    channels: [{ id: general, type: 0 }],
    threads: [],
  });

  return env;
}

const message = (
  id: string,
  author: string,
  channel: string,
  extra: Partial<Message> = {},
): Message => ({
  id,
  channel_id: channel,
  guild_id: guild,
  content: "hej",
  timestamp: "2026-01-01T00:00:00Z",
  author: { id: author, username: `user${author}`, bot: author === bot },
  ...extra,
});

const mentionBot = { mentions: [{ id: bot }] };
const thread = (id: string, owner: string): Channel => ({
  id,
  type: 11,
  guild_id: guild,
  parent_id: general,
  owner_id: owner,
});

describe("outside threads", () => {
  test("forwards DMs", async () => {
    const { forwarded } = await withGuild();

    const event = await forwarded(
      message("1", alice, "dm", { guild_id: undefined }),
    );

    expect(event?.trigger).toBe("dm");
    expect(event?.guild_id).toBeNull();
    expect(event?.thread_id).toBeNull();
  });

  test("forwards user and role mentions only", async () => {
    const { forwarded } = await withGuild();

    const user = await forwarded(message("2", alice, general, mentionBot));
    const role = await forwarded(
      message("3", alice, general, { mention_roles: [botRole] }),
    );
    const otherRole = await forwarded(
      message("4", alice, general, { mention_roles: ["701"] }),
    );
    const plain = await forwarded(message("5", alice, general));

    expect(user?.trigger).toBe("mention");
    expect(user?.guild_id).toBe(guild);
    expect(user?.thread_id).toBeNull();
    expect(role?.trigger).toBe("mention");
    expect(otherRole).toBeUndefined();
    expect(plain).toBeUndefined();
  });

  test("ignores strangers, other guilds and duplicates", async () => {
    const { forwarded } = await withGuild();

    expect(
      await forwarded(message("6", "3", general, mentionBot)),
    ).toBeUndefined();
    expect(
      await forwarded(
        message("7", alice, "x", { ...mentionBot, guild_id: "other" }),
      ),
    ).toBeUndefined();
    expect(
      await forwarded(message("8", alice, general, mentionBot)),
    ).toBeDefined();
    expect(
      await forwarded(message("8", alice, general, mentionBot)),
    ).toBeUndefined();
  });
});

describe("threads known from gateway events", () => {
  test("bot-created thread", async () => {
    const { send, forwarded, api } = await withGuild();

    await send("THREAD_CREATE", thread("t1", bot));
    const event = await forwarded(message("11", alice, "t1"));

    expect(event?.trigger).toBe("engaged_thread");
    expect(event?.thread_id).toBe("t1");
    expect(event?.parent_id).toBe(general);
    expect(api.calls).toBe(0);
  });

  test("thread started from a bot message", async () => {
    const { send, forwarded } = await withGuild();

    await send("MESSAGE_CREATE", message("t2", bot, general));
    await send("THREAD_CREATE", thread("t2", alice));

    expect((await forwarded(message("21", "2", "t2")))?.trigger).toBe(
      "engaged_thread",
    );
  });

  test("bot mentioned once in the thread", async () => {
    const { send, forwarded } = await withGuild();

    await send("THREAD_CREATE", thread("t3", alice));
    const mention = await forwarded(message("31", alice, "t3", mentionBot));
    const next = await forwarded(message("32", alice, "t3"));

    expect(mention?.trigger).toBe("mention");
    expect(mention?.thread_id).toBe("t3");
    expect(next?.trigger).toBe("engaged_thread");
  });

  test("bot posted in the thread", async () => {
    const { send, forwarded, api } = await withGuild();

    await send("THREAD_CREATE", thread("t4", alice));

    expect(await forwarded(message("41", bot, "t4"))).toBeUndefined();
    expect((await forwarded(message("42", alice, "t4")))?.trigger).toBe(
      "engaged_thread",
    );
    expect(await forwarded(message("43", "3", "t4"))).toBeUndefined();
    expect(api.calls).toBe(0);
  });
});

describe("threads looked up lazily over REST", () => {
  const api = () =>
    new FakeApi(
      {
        s1: thread("s1", alice),
        s2: thread("s2", alice),
        s3: thread("s3", alice),
        f1: { ...thread("f1", alice), parent_id: "forum" },
      },
      {
        [`${general}/s1`]: message("s1", bot, general),
        "f1/f1": message("f1", alice, "f1", { mention_roles: [botRole] }),
      },
      {
        s2: [message("x", alice, "s2"), message("y", alice, "s2", mentionBot)],
        s3: [message("z", alice, "s3")],
      },
    );

  test("resolves starters, forum posts and history, then caches", async () => {
    const env = await withGuild(api());

    expect((await env.forwarded(message("a", alice, "s1")))?.trigger).toBe(
      "engaged_thread",
    );
    expect((await env.forwarded(message("f", alice, "f1")))?.trigger).toBe(
      "engaged_thread",
    );
    expect((await env.forwarded(message("b", alice, "s2")))?.trigger).toBe(
      "engaged_thread",
    );
    expect(await env.forwarded(message("c", alice, "s3"))).toBeUndefined();

    const calls = env.api.calls;

    expect((await env.forwarded(message("a2", alice, "s1")))?.trigger).toBe(
      "engaged_thread",
    );
    expect(await env.forwarded(message("c2", alice, "s3"))).toBeUndefined();
    expect(env.api.calls).toBe(calls);
  });

  test("a later mention flips a cached negative", async () => {
    const env = await withGuild(api());

    expect(await env.forwarded(message("c", alice, "s3"))).toBeUndefined();
    expect(
      (await env.forwarded(message("c3", "2", "s3", mentionBot)))?.trigger,
    ).toBe("mention");
    expect((await env.forwarded(message("c4", alice, "s3")))?.trigger).toBe(
      "engaged_thread",
    );
  });
});

test("rate limit drops messages over the per-minute budget", async () => {
  const { forwarded } = await withGuild(new FakeApi(), 2);
  const dm = (id: string) => message(id, alice, "dm", { guild_id: undefined });

  expect(await forwarded(dm("r1"))).toBeDefined();
  expect(await forwarded(dm("r2"))).toBeDefined();
  expect(await forwarded(dm("r3"))).toBeUndefined();
});

test("never logs message contents", async () => {
  const lines: string[] = [];
  const posted: WebhookEvent[] = [];
  const relay = createRelay({
    allowedUserIds: new Set([alice]),
    allowedGuildIds: new Set(),
    api: new FakeApi(),
    dedupe: new Dedupe(60_000),
    limiter: new RateLimiter(10),
    negativeTtlMs: 1,
    webhook: { send: async (event) => void posted.push(event) },
    log: createLogger(
      { service: "test", level: "debug" },
      { write: (line) => lines.push(line) },
    ),
  });

  relay.handle(
    "MESSAGE_CREATE",
    message("1", alice, "dm", { guild_id: undefined, content: "top secret" }),
    bot,
  );
  relay.handle(
    "MESSAGE_CREATE",
    message("2", "3", "dm", { guild_id: undefined, content: "top secret" }),
    bot,
  );
  await relay.idle();

  expect(lines.length).toBeGreaterThan(0);
  expect(lines.join("")).not.toContain("top secret");
});

test("skips invalid payloads and logs only field paths", async () => {
  const lines: string[] = [];
  const posted: WebhookEvent[] = [];
  const relay = createRelay({
    allowedUserIds: new Set([alice]),
    allowedGuildIds: new Set(),
    api: new FakeApi(),
    dedupe: new Dedupe(60_000),
    limiter: new RateLimiter(10),
    negativeTtlMs: 1,
    webhook: { send: async (event) => void posted.push(event) },
    log: createLogger(
      { service: "test", level: "debug" },
      { write: (line) => lines.push(line) },
    ),
  });
  relay.handle(
    "MESSAGE_CREATE",
    { id: "1", author: { id: alice }, content: "top secret" },
    bot,
  );
  relay.handle("GUILD_ROLE_DELETE", { role_id: 7 }, bot);
  relay.handle(
    "MESSAGE_CREATE",
    { ...message("2", alice, "dm"), guild_id: null, content: "ok" },
    bot,
  );
  await relay.idle();

  const invalid = lines
    .map((line) => JSON.parse(line))
    .filter((line) => line.msg === "invalid payload, skipping");

  expect(invalid).toEqual([
    expect.objectContaining({
      event: "MESSAGE_CREATE",
      fields: ["channel_id"],
    }),
    expect.objectContaining({
      event: "GUILD_ROLE_DELETE",
      fields: ["role_id"],
    }),
  ]);
  expect(lines.join("")).not.toContain("top secret");
  expect(posted.map((event) => [event.message_id, event.trigger])).toEqual([
    ["2", "dm"],
  ]);
});

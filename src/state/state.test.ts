import { expect, test } from "bun:test";
import type { Message } from "../discord/schemas.ts";
import { BotIdentity } from "./bot-identity.ts";
import { BotRelatedMessages } from "./bot-related-messages.ts";
import { BoundedMap } from "./bounded-map.ts";
import { EngagementCache } from "./engagement-cache.ts";

const message = (extra: Partial<Message>): Message => ({
  id: "m",
  channel_id: "c",
  author: { id: "1" },
  ...extra,
});

test("bot identity recognizes its messages, mentions and managed roles", () => {
  const identity = new BotIdentity();

  identity.rememberRole({ id: "r", tags: { bot_id: "9" } });

  expect(identity.known).toBe(false);
  expect(identity.managedRoleCount).toBe(0);

  identity.id = "9";
  identity.rememberRole({ id: "r", tags: { bot_id: "9" } });
  identity.rememberRole({ id: "other", tags: { bot_id: "8" } });

  expect(identity.managedRoleCount).toBe(1);
  expect(identity.authored(message({ author: { id: "9" } }))).toBe(true);
  expect(identity.mentionedIn(message({ mentions: [{ id: "9" }] }))).toBe(true);
  expect(identity.mentionedIn(message({ mention_roles: ["r"] }))).toBe(true);
  expect(identity.mentionedIn(message({ mention_roles: ["other"] }))).toBe(
    false,
  );

  identity.forgetRole("r");

  expect(identity.mentionedIn(message({ mention_roles: ["r"] }))).toBe(false);
});

test("engagement cache never downgrades and expires negatives", () => {
  let now = 0;
  const cache = new EngagementCache(1_000, () => now);

  cache.remember("yes", true);
  cache.remember("yes", false);
  cache.remember("no", false);

  expect(cache.lookup("yes")).toBe(true);
  expect(cache.lookup("no")).toBe(false);

  now = 2_000;

  expect(cache.lookup("yes")).toBe(true);
  expect(cache.lookup("no")).toBeUndefined();
  expect(cache.lookup("unknown")).toBeUndefined();
});

test("bounded map clears itself when full", () => {
  const map = new BoundedMap<string, number>(2);

  map.set("a", 1);
  map.set("b", 2);
  map.set("c", 3);

  expect(map.size).toBe(1);
  expect(map.get("c")).toBe(3);
});

test("bot related messages remember ids", () => {
  const related = new BotRelatedMessages(() => 0);

  related.add("1");

  expect(related.has("1")).toBe(true);
  expect(related.has("2")).toBe(false);
});

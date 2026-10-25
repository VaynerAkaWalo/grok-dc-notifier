import { expect, test } from "bun:test";
import {
  channelSchema,
  failedFieldPaths,
  guildSchema,
  messageSchema,
} from "./schemas.ts";

test("message schema keeps read fields and strips the rest", () => {
  const message = messageSchema.parse({
    id: "1",
    channel_id: "2",
    author: { id: "3", username: "alice", global_name: "Alice" },
    content: "hej",
    mentions: [{ id: "4" }],
    pinned: false,
    referenced_message: {
      id: "5",
      channel_id: "2",
      author: { id: "4" },
      referenced_message: { id: "6" },
    },
  });

  expect(message.author).toEqual({ id: "3", username: "alice" });
  expect(message.mentions).toEqual([{ id: "4" }]);
  expect(message).not.toHaveProperty("pinned");
  expect(message.referenced_message?.id).toBe("5");
  expect(message.referenced_message).not.toHaveProperty("referenced_message");
});

test("optional fields accept null as missing", () => {
  const message = messageSchema.parse({
    id: "1",
    channel_id: "2",
    guild_id: null,
    author: { id: "3", bot: null },
    content: null,
    webhook_id: null,
    referenced_message: null,
  });

  expect(message.guild_id).toBeUndefined();
  expect(message.author.bot).toBeUndefined();
  expect(message.content).toBeUndefined();
  expect(message.referenced_message).toBeNull();
});

test("channel and guild schemas", () => {
  expect(channelSchema.parse({ id: "t", type: 11, parent_id: null })).toEqual({
    id: "t",
    type: 11,
    parent_id: null,
  });

  const guild = guildSchema.parse({
    id: "g",
    roles: [{ id: "r", tags: { bot_id: "b", premium_subscriber: null } }],
    channels: [{ id: "c", type: 0 }],
  });

  expect(guild.roles?.[0]?.tags).toEqual({ bot_id: "b" });
  expect(guild.threads).toBeUndefined();
});

test("failedFieldPaths reports field paths without values", () => {
  const result = messageSchema.safeParse({
    id: "1",
    channel_id: 2,
    author: {},
    content: "secret text",
    mentions: [{ id: 5 }],
  });

  expect(result.success).toBe(false);

  const paths = result.success ? [] : failedFieldPaths(result.error);

  expect(paths).toEqual(["channel_id", "author.id", "mentions.0.id"]);
  expect(paths.join()).not.toContain("secret");
});

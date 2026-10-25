// Zod schemas for the parts of Discord payloads the notifier reads. Unknown
// fields are stripped. Optional fields also accept null, so a field Discord
// sends as null is treated like a missing one.

import { z } from "zod";

const optional = <T extends z.ZodType>(schema: T) =>
  schema
    .nullish()
    .transform((value) => value ?? undefined)
    .optional();

export const userSchema = z.object({
  id: z.string(),
  username: optional(z.string()),
  bot: optional(z.boolean()),
});

export type User = z.infer<typeof userSchema>;

const messageFields = {
  id: z.string(),
  channel_id: z.string(),
  guild_id: optional(z.string()),
  author: userSchema,
  content: optional(z.string()),
  timestamp: optional(z.string()),
  mentions: optional(z.array(userSchema)),
  mention_roles: optional(z.array(z.string())),
  webhook_id: optional(z.string()),
};

// A replied-to message, one level deep.
export const referencedMessageSchema = z.object(messageFields);

export type ReferencedMessage = z.infer<typeof referencedMessageSchema>;

export const messageSchema = z.object({
  ...messageFields,
  referenced_message: referencedMessageSchema.nullable().optional(),
});

export type Message = z.infer<typeof messageSchema>;

// Announcement, public and private threads.
export const threadTypes = new Set([10, 11, 12]);

export const channelSchema = z.object({
  id: z.string(),
  type: optional(z.number()),
  guild_id: optional(z.string()),
  parent_id: z.string().nullable().optional(),
  owner_id: optional(z.string()),
});

export type Channel = z.infer<typeof channelSchema>;

export const isThread = (channel: Channel | undefined) =>
  channel?.type !== undefined && threadTypes.has(channel.type);

export const roleSchema = z.object({
  id: z.string(),
  tags: optional(z.object({ bot_id: optional(z.string()) })),
});

export type Role = z.infer<typeof roleSchema>;

// The subset of GUILD_CREATE the notifier reads.
export const guildSchema = z.object({
  id: z.string(),
  roles: optional(z.array(roleSchema)),
  channels: optional(z.array(channelSchema)),
  threads: optional(z.array(channelSchema)),
});

export type Guild = z.infer<typeof guildSchema>;

export const roleEventSchema = z.object({ role: roleSchema });

export const roleDeleteSchema = z.object({ role_id: z.string() });

export const threadListSyncSchema = z.object({
  threads: optional(z.array(channelSchema)),
});

// Field paths of a failed parse, for logs. Never includes payload values.
export const issuePaths = (error: z.ZodError) =>
  error.issues.map((issue) => issue.path.join(".") || "(root)");

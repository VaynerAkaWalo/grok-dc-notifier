import { z } from "zod";

const nullAsMissing = <T extends z.ZodType>(schema: T) =>
  schema
    .nullish()
    .transform((value) => value ?? undefined)
    .optional();

export const userSchema = z.object({
  id: z.string(),
  username: nullAsMissing(z.string()),
  bot: nullAsMissing(z.boolean()),
});

export type User = z.infer<typeof userSchema>;

const messageFields = {
  id: z.string(),
  channel_id: z.string(),
  guild_id: nullAsMissing(z.string()),
  author: userSchema,
  content: nullAsMissing(z.string()),
  timestamp: nullAsMissing(z.string()),
  mentions: nullAsMissing(z.array(userSchema)),
  mention_roles: nullAsMissing(z.array(z.string())),
  webhook_id: nullAsMissing(z.string()),
};

export const referencedMessageSchema = z.object(messageFields);

export type ReferencedMessage = z.infer<typeof referencedMessageSchema>;

export const messageSchema = z.object({
  ...messageFields,
  referenced_message: referencedMessageSchema.nullable().optional(),
});

export type Message = z.infer<typeof messageSchema>;

const ChannelType = {
  announcementThread: 10,
  publicThread: 11,
  privateThread: 12,
} as const;

const threadTypes = new Set<number>([
  ChannelType.announcementThread,
  ChannelType.publicThread,
  ChannelType.privateThread,
]);

export const channelSchema = z.object({
  id: z.string(),
  type: nullAsMissing(z.number()),
  guild_id: nullAsMissing(z.string()),
  parent_id: z.string().nullable().optional(),
  owner_id: nullAsMissing(z.string()),
});

export type Channel = z.infer<typeof channelSchema>;

export const isThread = (
  channel: Channel | undefined,
): channel is Channel & { type: number } =>
  channel?.type !== undefined && threadTypes.has(channel.type);

export const roleSchema = z.object({
  id: z.string(),
  tags: nullAsMissing(z.object({ bot_id: nullAsMissing(z.string()) })),
});

export type Role = z.infer<typeof roleSchema>;

export const guildSchema = z.object({
  id: z.string(),
  roles: nullAsMissing(z.array(roleSchema)),
  channels: nullAsMissing(z.array(channelSchema)),
  threads: nullAsMissing(z.array(channelSchema)),
});

export type Guild = z.infer<typeof guildSchema>;

export const roleEventSchema = z.object({ role: roleSchema });

export const roleDeleteSchema = z.object({ role_id: z.string() });

export const threadListSyncSchema = z.object({
  threads: nullAsMissing(z.array(channelSchema)),
});

export const failedFieldPaths = (error: z.ZodError) =>
  error.issues.map((issue) => issue.path.join(".") || "(root)");

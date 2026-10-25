import { z } from "zod";

const Intent = {
  guilds: 1 << 0,
  guildMessages: 1 << 9,
  directMessages: 1 << 12,
  messageContent: 1 << 15,
} as const;

export const intents =
  Intent.guilds |
  Intent.guildMessages |
  Intent.directMessages |
  Intent.messageContent;

export const Opcode = {
  dispatch: 0,
  heartbeat: 1,
  identify: 2,
  resume: 6,
  reconnect: 7,
  invalidSession: 9,
  hello: 10,
  heartbeatAck: 11,
} as const;

export const CloseCode = {
  normal: 1000,
  keepSessionResumable: 4000,
} as const;

export const unrecoverableCloseCodes: Record<number, string> = {
  4004: "authentication failed (bad DISCORD_BOT_TOKEN)",
  4010: "invalid shard",
  4011: "sharding required",
  4012: "invalid API version",
  4013: "invalid intents",
  4014: "disallowed intents (enable Message Content Intent in the Developer Portal)",
};

export const sessionEndingCloseCodes = new Set([4007, 4009]);

export class FatalGatewayError extends Error {
  constructor(
    readonly code: number,
    detail: string,
  ) {
    super(`fatal gateway close ${code}: ${detail}`);
  }
}

export const payloadSchema = z.object({
  op: z.number(),
  d: z.unknown().optional(),
  s: z.number().nullish(),
  t: z.string().nullish(),
});

export type Payload = z.infer<typeof payloadSchema>;

export const helloSchema = z.object({
  heartbeat_interval: z.number().positive(),
});

const ignoredWhenMalformed = <T extends z.ZodType>(schema: T) =>
  schema.optional().catch(undefined);

export const readySchema = z.object({
  session_id: ignoredWhenMalformed(z.string()),
  resume_gateway_url: ignoredWhenMalformed(z.string()),
  user: ignoredWhenMalformed(
    z.object({
      id: ignoredWhenMalformed(z.string()),
      username: ignoredWhenMalformed(z.string()),
    }),
  ),
});

export type Ready = z.infer<typeof readySchema>;

export const parseReady = (data: unknown): Ready =>
  readySchema.catch({}).parse(data);

export function decodeFrame(raw: string): Payload | undefined {
  let json: unknown;

  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const parsed = payloadSchema.safeParse(json);

  return parsed.success ? parsed.data : undefined;
}

export function withGatewayQuery(baseUrl: string): string {
  const url = new URL(baseUrl);

  url.searchParams.set("v", "10");
  url.searchParams.set("encoding", "json");

  return url.toString();
}

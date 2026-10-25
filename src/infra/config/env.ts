import { z } from "zod";
import { logLevels } from "../logger.ts";
import { parseDuration, parseIdList } from "./env-parsers.ts";

export type EnvSource = Record<string, string | undefined>;

const trimmedOrUnset = (value: unknown) =>
  typeof value === "string" ? value.trim() || undefined : value;

const unsetWhenBlank = <T extends z.ZodType>(schema: T) =>
  z.preprocess(trimmedOrUnset, schema);

const required = (message: string) =>
  z.string({ error: message }).trim().min(1, { error: message });

const duration = (key: string, defaultMs: number) => {
  const message = `${key} must be a positive duration like 30s`;

  return unsetWhenBlank(
    z
      .string()
      .transform((raw, ctx) => {
        const ms = parseDuration(raw);

        if (ms === undefined) {
          ctx.issues.push({ code: "custom", message, input: raw });

          return z.NEVER;
        }

        return ms;
      })
      .default(defaultMs),
  );
};

const positiveInteger = (key: string, defaultValue: number) => {
  const message = `${key} must be a positive integer`;

  return unsetWhenBlank(
    z.coerce
      .number({ error: message })
      .refine((value) => Number.isInteger(value) && value >= 1, { message })
      .default(defaultValue),
  );
};

const envSchema = z.object({
  APP_NAME: unsetWhenBlank(z.string().trim().default("grok-dc-notifier")),
  PORT: positiveInteger("PORT", 8080),
  LOG_LEVEL: unsetWhenBlank(
    z
      .enum(logLevels, {
        error: `LOG_LEVEL must be one of ${logLevels.join(", ")}`,
      })
      .default("info"),
  ),

  DISCORD_BOT_TOKEN: unsetWhenBlank(required("DISCORD_BOT_TOKEN is required")),
  DISCORD_GATEWAY_URL: unsetWhenBlank(
    z
      .url({
        protocol: /^wss?$/,
        error: "DISCORD_GATEWAY_URL must be a ws(s) URL",
      })
      .default("wss://gateway.discord.gg"),
  ),
  ALLOWED_USER_IDS: unsetWhenBlank(
    z
      .string({
        error: "ALLOWED_USER_IDS must list at least one Discord user ID",
      })
      .transform(parseIdList)
      .refine((ids) => ids.size > 0, {
        message: "ALLOWED_USER_IDS must list at least one Discord user ID",
      }),
  ),
  ALLOWED_GUILD_IDS: unsetWhenBlank(z.string().optional()).transform(
    parseIdList,
  ),

  WEBHOOK_URL: unsetWhenBlank(
    z.url({
      protocol: /^https?$/,
      error: "WEBHOOK_URL must be an http(s) URL",
    }),
  ),
  WEBHOOK_AUTH_HEADER: unsetWhenBlank(
    required(
      "WEBHOOK_AUTH_HEADER is required (full Authorization header value)",
    ),
  ),
  WEBHOOK_TIMEOUT: duration("WEBHOOK_TIMEOUT", 8_000),

  RATE_LIMIT_PER_MINUTE: positiveInteger("RATE_LIMIT_PER_MINUTE", 6),
  DEDUPE_TTL: duration("DEDUPE_TTL", 15 * 60_000),
  THREAD_NEGATIVE_TTL: duration("THREAD_NEGATIVE_TTL", 30 * 60_000),
  STALE_AFTER: duration("STALE_AFTER", 3 * 60_000),
});

export type Env = z.infer<typeof envSchema>;

export class InvalidConfigError extends Error {
  constructor(problems: string[]) {
    super(problems.join("; "));
  }
}

export function parseEnv(source: EnvSource = Bun.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    throw new InvalidConfigError(
      parsed.error.issues.map((issue) => issue.message),
    );
  }

  return parsed.data;
}

import { z } from "zod";
import type { Level } from "./logger.ts";

export interface Config {
  discordToken: string;
  gatewayUrl: string;
  allowedUserIds: Set<string>;
  // Optional: limits guild messages to these servers. DMs are unaffected.
  allowedGuildIds: Set<string>;
  webhookUrl: string;
  // Full Authorization header value, e.g. "Bearer crsr_...".
  webhookAuthHeader: string;
  webhookTimeoutMs: number;
  ratePerMinute: number;
  dedupeTtlMs: number;
  threadNegativeTtlMs: number;
  staleAfterMs: number;
  port: number;
  logLevel: Level;
}

type Env = Record<string, string | undefined>;

export function idSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

// Accepts "1500ms", "30s", "15m", "1h" or a plain number of milliseconds.
export function parseDuration(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(value.trim());

  if (!match?.[1]) {
    return undefined;
  }

  const unit = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[
    (match[2] ?? "ms") as "ms" | "s" | "m" | "h"
  ];
  const ms = Number(match[1]) * unit;

  return ms > 0 ? ms : undefined;
}

// Every value is trimmed and an unset variable reads as "". Issues are
// collected across all variables and reported together.
const text = () => z.string().trim().prefault("");

const required = (message: string) =>
  z.string().trim().min(1, message).prefault("");

const duration = (key: string, fallbackMs: number) =>
  text().transform((raw, ctx) => {
    if (!raw) {
      return fallbackMs;
    }

    const ms = parseDuration(raw);

    if (ms === undefined) {
      ctx.issues.push({
        code: "custom",
        message: `${key} must be a positive duration like 30s`,
        input: raw,
      });

      return z.NEVER;
    }

    return ms;
  });

const integer = (key: string, fallback: number) =>
  text().transform((raw, ctx) => {
    if (!raw) {
      return fallback;
    }

    const n = Number(raw);

    if (!Number.isInteger(n) || n < 1) {
      ctx.issues.push({
        code: "custom",
        message: `${key} must be a positive integer`,
        input: raw,
      });

      return z.NEVER;
    }

    return n;
  });

export const envSchema = z
  .object({
    DISCORD_BOT_TOKEN: required("DISCORD_BOT_TOKEN is required"),
    ALLOWED_USER_IDS: text()
      .transform(idSet)
      .refine((ids) => ids.size > 0, {
        message: "ALLOWED_USER_IDS must list at least one Discord user ID",
      }),
    WEBHOOK_URL: z
      .string()
      .trim()
      .regex(/^https?:\/\/[^\s]+$/, "WEBHOOK_URL must be an http(s) URL")
      .prefault(""),
    WEBHOOK_AUTH_HEADER: required(
      "WEBHOOK_AUTH_HEADER is required (full Authorization header value)",
    ),
    ALLOWED_GUILD_IDS: text().transform(idSet),
    DISCORD_GATEWAY_URL: text().transform(
      (url) => url || "wss://gateway.discord.gg",
    ),
    WEBHOOK_TIMEOUT: duration("WEBHOOK_TIMEOUT", 8_000),
    RATE_LIMIT_PER_MINUTE: integer("RATE_LIMIT_PER_MINUTE", 6),
    DEDUPE_TTL: duration("DEDUPE_TTL", 15 * 60_000),
    THREAD_NEGATIVE_TTL: duration("THREAD_NEGATIVE_TTL", 30 * 60_000),
    STALE_AFTER: duration("STALE_AFTER", 3 * 60_000),
    PORT: integer("PORT", 8080),
    LOG_LEVEL: text().transform(
      (level): Level => (level === "debug" ? "debug" : "info"),
    ),
  })
  .transform(
    (env): Config => ({
      discordToken: env.DISCORD_BOT_TOKEN,
      gatewayUrl: env.DISCORD_GATEWAY_URL,
      allowedUserIds: env.ALLOWED_USER_IDS,
      allowedGuildIds: env.ALLOWED_GUILD_IDS,
      webhookUrl: env.WEBHOOK_URL,
      webhookAuthHeader: env.WEBHOOK_AUTH_HEADER,
      webhookTimeoutMs: env.WEBHOOK_TIMEOUT,
      ratePerMinute: env.RATE_LIMIT_PER_MINUTE,
      dedupeTtlMs: env.DEDUPE_TTL,
      threadNegativeTtlMs: env.THREAD_NEGATIVE_TTL,
      staleAfterMs: env.STALE_AFTER,
      port: env.PORT,
      logLevel: env.LOG_LEVEL,
    }),
  );

// Throws one error listing every invalid variable. Messages name variables,
// never their values.
export function loadConfig(env: Env = process.env): Config {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    throw new Error(
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }

  return parsed.data;
}

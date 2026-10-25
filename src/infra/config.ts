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

export function loadConfig(env: Env = process.env): Config {
  const errors: string[] = [];
  const str = (key: string) => (env[key] ?? "").trim();

  const duration = (key: string, fallbackMs: number) => {
    const raw = str(key);

    if (!raw) {
      return fallbackMs;
    }

    const ms = parseDuration(raw);

    if (ms === undefined) {
      errors.push(`${key} must be a positive duration like 30s`);
    }

    return ms ?? fallbackMs;
  };

  const integer = (key: string, fallback: number) => {
    const raw = str(key);

    if (!raw) {
      return fallback;
    }

    const n = Number(raw);

    if (!Number.isInteger(n) || n < 1) {
      errors.push(`${key} must be a positive integer`);
    }

    return n;
  };

  const config: Config = {
    discordToken: str("DISCORD_BOT_TOKEN"),
    gatewayUrl: str("DISCORD_GATEWAY_URL") || "wss://gateway.discord.gg",
    allowedUserIds: idSet(env.ALLOWED_USER_IDS),
    allowedGuildIds: idSet(env.ALLOWED_GUILD_IDS),
    webhookUrl: str("WEBHOOK_URL"),
    webhookAuthHeader: str("WEBHOOK_AUTH_HEADER"),
    webhookTimeoutMs: duration("WEBHOOK_TIMEOUT", 8_000),
    ratePerMinute: integer("RATE_LIMIT_PER_MINUTE", 6),
    dedupeTtlMs: duration("DEDUPE_TTL", 15 * 60_000),
    threadNegativeTtlMs: duration("THREAD_NEGATIVE_TTL", 30 * 60_000),
    staleAfterMs: duration("STALE_AFTER", 3 * 60_000),
    port: integer("PORT", 8080),
    logLevel: str("LOG_LEVEL") === "debug" ? "debug" : "info",
  };

  if (!config.discordToken) {
    errors.push("DISCORD_BOT_TOKEN is required");
  }

  if (config.allowedUserIds.size === 0) {
    errors.push("ALLOWED_USER_IDS must list at least one Discord user ID");
  }

  if (!/^https?:\/\/[^\s]+$/.test(config.webhookUrl)) {
    errors.push("WEBHOOK_URL must be an http(s) URL");
  }

  if (!config.webhookAuthHeader) {
    errors.push(
      "WEBHOOK_AUTH_HEADER is required (full Authorization header value)",
    );
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return config;
}

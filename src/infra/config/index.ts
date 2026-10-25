import { type EnvSource, parseEnv } from "./env.ts";

export function loadConfig(source: EnvSource = Bun.env) {
  const env = parseEnv(source);

  return {
    app: {
      name: env.APP_NAME,
      port: env.PORT,
    },

    logging: {
      level: env.LOG_LEVEL,
    },

    discord: {
      token: env.DISCORD_BOT_TOKEN,
      gatewayUrl: env.DISCORD_GATEWAY_URL,
      allowedUserIds: env.ALLOWED_USER_IDS,
      allowedGuildIds: env.ALLOWED_GUILD_IDS,
    },

    webhook: {
      url: env.WEBHOOK_URL,
      authHeader: env.WEBHOOK_AUTH_HEADER,
      timeoutMs: env.WEBHOOK_TIMEOUT,
    },

    relay: {
      ratePerMinute: env.RATE_LIMIT_PER_MINUTE,
      dedupeTtlMs: env.DEDUPE_TTL,
      threadNegativeTtlMs: env.THREAD_NEGATIVE_TTL,
    },

    health: {
      staleAfterMs: env.STALE_AFTER,
    },
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;

import { describe, expect, test } from "bun:test";
import { parseDuration, parseIdList } from "./env-parsers.ts";
import { loadConfig } from "./index.ts";

const required = {
  DISCORD_BOT_TOKEN: "t",
  ALLOWED_USER_IDS: "1",
  WEBHOOK_URL: "https://example.com/hook",
  WEBHOOK_AUTH_HEADER: "Bearer k",
};

describe("loadConfig", () => {
  test("parses ids and applies defaults", () => {
    const config = loadConfig({
      ...required,
      ALLOWED_USER_IDS: " 1, 2 ,,",
      ALLOWED_GUILD_IDS: "9",
    });

    expect([...config.discord.allowedUserIds]).toEqual(["1", "2"]);
    expect([...config.discord.allowedGuildIds]).toEqual(["9"]);
    expect(config.discord.gatewayUrl).toBe("wss://gateway.discord.gg");
    expect(config.app).toEqual({ name: "grok-dc-notifier", port: 8080 });
    expect(config.logging.level).toBe("info");
    expect(config.webhook.timeoutMs).toBe(8_000);
    expect(config.relay).toEqual({
      ratePerMinute: 6,
      dedupeTtlMs: 15 * 60_000,
      threadNegativeTtlMs: 30 * 60_000,
    });
    expect(config.health.staleAfterMs).toBe(3 * 60_000);
  });

  test("reports every missing value", () => {
    expect(() => loadConfig({})).toThrow(
      "DISCORD_BOT_TOKEN is required; " +
        "ALLOWED_USER_IDS must list at least one Discord user ID; " +
        "WEBHOOK_URL must be an http(s) URL; " +
        "WEBHOOK_AUTH_HEADER is required (full Authorization header value)",
    );
  });

  test("treats blank values as missing", () => {
    expect(() =>
      loadConfig({
        ...required,
        DISCORD_BOT_TOKEN: "  ",
        ALLOWED_USER_IDS: " , ",
        PORT: " ",
      }),
    ).toThrow(
      "DISCORD_BOT_TOKEN is required; ALLOWED_USER_IDS must list at least one Discord user ID",
    );
  });

  test("trims values and reads every override", () => {
    const config = loadConfig({
      APP_NAME: "notifier",
      DISCORD_BOT_TOKEN: " t ",
      ALLOWED_USER_IDS: "1",
      WEBHOOK_URL: " https://example.com/hook ",
      WEBHOOK_AUTH_HEADER: " Bearer k ",
      DISCORD_GATEWAY_URL: "wss://example.com",
      WEBHOOK_TIMEOUT: "2s",
      RATE_LIMIT_PER_MINUTE: "20",
      DEDUPE_TTL: "1h",
      THREAD_NEGATIVE_TTL: "90s",
      STALE_AFTER: "500",
      PORT: "9000",
      LOG_LEVEL: "debug",
    });

    expect(config).toEqual({
      app: { name: "notifier", port: 9000 },
      logging: { level: "debug" },
      discord: {
        token: "t",
        gatewayUrl: "wss://example.com",
        allowedUserIds: new Set(["1"]),
        allowedGuildIds: new Set(),
      },
      webhook: {
        url: "https://example.com/hook",
        authHeader: "Bearer k",
        timeoutMs: 2_000,
      },
      relay: {
        ratePerMinute: 20,
        dedupeTtlMs: 3_600_000,
        threadNegativeTtlMs: 90_000,
      },
      health: { staleAfterMs: 500 },
    });
  });

  test("never echoes values in errors", () => {
    expect(() =>
      loadConfig({ ...required, WEBHOOK_URL: "ftp://secret-host" }),
    ).toThrow(/^WEBHOOK_URL must be an http\(s\) URL$/);
  });

  test("rejects bad numbers, durations and levels", () => {
    expect(() =>
      loadConfig({ ...required, RATE_LIMIT_PER_MINUTE: "0" }),
    ).toThrow("RATE_LIMIT_PER_MINUTE must be a positive integer");
    expect(() => loadConfig({ ...required, PORT: "80.5" })).toThrow(
      "PORT must be a positive integer",
    );
    expect(() => loadConfig({ ...required, PORT: "abc" })).toThrow(
      "PORT must be a positive integer",
    );
    expect(() => loadConfig({ ...required, DEDUPE_TTL: "soon" })).toThrow(
      "DEDUPE_TTL must be a positive duration like 30s",
    );
    expect(() => loadConfig({ ...required, LOG_LEVEL: "loud" })).toThrow(
      "LOG_LEVEL must be one of trace, debug, info, warn, error, fatal",
    );
    expect(() =>
      loadConfig({ ...required, WEBHOOK_TIMEOUT: "0s", STALE_AFTER: "-1m" }),
    ).toThrow(
      "WEBHOOK_TIMEOUT must be a positive duration like 30s; STALE_AFTER must be a positive duration like 30s",
    );
  });
});

test("parseDuration", () => {
  expect(parseDuration("8s")).toBe(8_000);
  expect(parseDuration("15m")).toBe(900_000);
  expect(parseDuration("250")).toBe(250);
  expect(parseDuration("0s")).toBeUndefined();
  expect(parseDuration("x")).toBeUndefined();
});

test("parseIdList", () => {
  expect([...parseIdList(" 1, 2 ,,")]).toEqual(["1", "2"]);
  expect(parseIdList(undefined).size).toBe(0);
});

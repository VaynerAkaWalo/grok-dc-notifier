import { describe, expect, test } from "bun:test";
import { loadConfig, parseDuration } from "./config.ts";

describe("loadConfig", () => {
  test("parses ids and applies defaults", () => {
    const config = loadConfig({
      DISCORD_BOT_TOKEN: "t",
      ALLOWED_USER_IDS: " 1, 2 ,,",
      ALLOWED_GUILD_IDS: "9",
      WEBHOOK_URL: "https://example.com/hook",
      WEBHOOK_AUTH_HEADER: "Bearer k",
    });

    expect([...config.allowedUserIds]).toEqual(["1", "2"]);
    expect([...config.allowedGuildIds]).toEqual(["9"]);
    expect(config.ratePerMinute).toBe(6);
    expect(config.port).toBe(8080);
    expect(config.dedupeTtlMs).toBe(15 * 60_000);
    expect(config.threadNegativeTtlMs).toBe(30 * 60_000);
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
        DISCORD_BOT_TOKEN: "  ",
        ALLOWED_USER_IDS: " , ",
        WEBHOOK_URL: "https://example.com/hook",
        WEBHOOK_AUTH_HEADER: "Bearer k",
      }),
    ).toThrow(
      "DISCORD_BOT_TOKEN is required; ALLOWED_USER_IDS must list at least one Discord user ID",
    );
  });

  test("trims values and reads every override", () => {
    const config = loadConfig({
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
      discordToken: "t",
      gatewayUrl: "wss://example.com",
      allowedUserIds: new Set(["1"]),
      allowedGuildIds: new Set(),
      webhookUrl: "https://example.com/hook",
      webhookAuthHeader: "Bearer k",
      webhookTimeoutMs: 2_000,
      ratePerMinute: 20,
      dedupeTtlMs: 3_600_000,
      threadNegativeTtlMs: 90_000,
      staleAfterMs: 500,
      port: 9000,
      logLevel: "debug",
    });
  });

  test("never echoes values in errors", () => {
    expect(() =>
      loadConfig({
        DISCORD_BOT_TOKEN: "t",
        ALLOWED_USER_IDS: "1",
        WEBHOOK_URL: "ftp://secret-host",
        WEBHOOK_AUTH_HEADER: "Bearer k",
      }),
    ).toThrow(/^WEBHOOK_URL must be an http\(s\) URL$/);
  });

  test("rejects bad numbers and durations", () => {
    const base = {
      DISCORD_BOT_TOKEN: "t",
      ALLOWED_USER_IDS: "1",
      WEBHOOK_URL: "https://example.com/hook",
      WEBHOOK_AUTH_HEADER: "Bearer k",
    };

    expect(() => loadConfig({ ...base, RATE_LIMIT_PER_MINUTE: "0" })).toThrow(
      "RATE_LIMIT_PER_MINUTE must be a positive integer",
    );
    expect(() => loadConfig({ ...base, PORT: "80.5" })).toThrow(
      "PORT must be a positive integer",
    );
    expect(() => loadConfig({ ...base, DEDUPE_TTL: "soon" })).toThrow(
      "DEDUPE_TTL must be a positive duration like 30s",
    );
    expect(() =>
      loadConfig({ ...base, WEBHOOK_TIMEOUT: "0s", STALE_AFTER: "-1m" }),
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

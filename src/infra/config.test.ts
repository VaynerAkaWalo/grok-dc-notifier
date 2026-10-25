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
      /DISCORD_BOT_TOKEN.*ALLOWED_USER_IDS.*WEBHOOK_URL.*WEBHOOK_AUTH_HEADER/,
    );
  });

  test("rejects bad numbers and durations", () => {
    const base = {
      DISCORD_BOT_TOKEN: "t",
      ALLOWED_USER_IDS: "1",
      WEBHOOK_URL: "https://example.com/hook",
      WEBHOOK_AUTH_HEADER: "Bearer k",
    };

    expect(() => loadConfig({ ...base, RATE_LIMIT_PER_MINUTE: "0" })).toThrow();
    expect(() => loadConfig({ ...base, DEDUPE_TTL: "soon" })).toThrow();
  });
});

test("parseDuration", () => {
  expect(parseDuration("8s")).toBe(8_000);
  expect(parseDuration("15m")).toBe(900_000);
  expect(parseDuration("250")).toBe(250);
  expect(parseDuration("0s")).toBeUndefined();
  expect(parseDuration("x")).toBeUndefined();
});

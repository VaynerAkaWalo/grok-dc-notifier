import { expect, test } from "bun:test";
import { Dedupe } from "./dedupe.ts";
import { RateLimiter } from "./rate-limiter.ts";

test("dedupe drops repeats within the TTL", () => {
  let now = 0;
  const dedupe = new Dedupe(60_000, () => now);

  expect(dedupe.isFirstSighting("x")).toBe(true);
  expect(dedupe.isFirstSighting("x")).toBe(false);

  now += 120_000;

  expect(dedupe.isFirstSighting("x")).toBe(true);
});

test("rate limiter uses a sliding 60 s window", () => {
  let now = 0;
  const limiter = new RateLimiter(2, () => now);

  expect(limiter.tryAcquire()).toBe(true);
  expect(limiter.tryAcquire()).toBe(true);
  expect(limiter.tryAcquire()).toBe(false);

  now += 61_000;

  expect(limiter.tryAcquire()).toBe(true);
});

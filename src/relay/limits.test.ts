import { expect, test } from "bun:test";
import { Dedupe, Limiter } from "./limits.ts";

test("dedupe drops repeats within the TTL", () => {
  let now = 0;
  const dedupe = new Dedupe(60_000, () => now);

  expect(dedupe.first("x")).toBe(true);
  expect(dedupe.first("x")).toBe(false);

  now += 120_000;

  expect(dedupe.first("x")).toBe(true);
});

test("limiter uses a sliding 60 s window", () => {
  let now = 0;
  const limiter = new Limiter(2, () => now);

  expect(limiter.allow()).toBe(true);
  expect(limiter.allow()).toBe(true);
  expect(limiter.allow()).toBe(false);

  now += 61_000;

  expect(limiter.allow()).toBe(true);
});

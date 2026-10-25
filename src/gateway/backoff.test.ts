import { expect, test } from "bun:test";
import { Backoff } from "./backoff.ts";

test("doubles up to the maximum with up to 50% jitter and resets", () => {
  const backoff = new Backoff(100, 300, () => 0.5);

  expect(backoff.nextDelayMs()).toBe(125);
  expect(backoff.nextDelayMs()).toBe(250);
  expect(backoff.nextDelayMs()).toBe(375);
  expect(backoff.nextDelayMs()).toBe(375);

  backoff.reset();

  expect(backoff.nextDelayMs()).toBe(125);
});

import { expect, test } from "bun:test";
import { SerialQueue } from "./serial-queue.ts";

test("runs tasks one at a time in order and keeps going after a failure", async () => {
  const queue = new SerialQueue(10);
  const order: string[] = [];
  const errors: unknown[] = [];

  queue.tryEnqueue(async () => {
    await Bun.sleep(5);
    order.push("slow");
  }, errors.push.bind(errors));
  queue.tryEnqueue(async () => {
    throw new Error("boom");
  }, errors.push.bind(errors));
  queue.tryEnqueue(async () => {
    order.push("fast");
  }, errors.push.bind(errors));
  await queue.drained();

  expect(order).toEqual(["slow", "fast"]);
  expect(errors).toHaveLength(1);
  expect(queue.size).toBe(0);
});

test("rejects tasks beyond its capacity", async () => {
  const queue = new SerialQueue(1);
  const ignore = () => {};

  expect(queue.tryEnqueue(() => Bun.sleep(5), ignore)).toBe(true);
  expect(queue.tryEnqueue(async () => {}, ignore)).toBe(false);

  await queue.drained();
});

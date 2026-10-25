import { expect, test } from "bun:test";
import { createLogger } from "./logger.ts";

test("writes JSON lines, respects level and flattens errors", () => {
  const lines: string[] = [];
  const log = createLogger("svc", "info", (line) => lines.push(line));

  log.debug("hidden");
  log.info("hello", { messageId: "1" });
  log.error("failed", { err: new Error("boom") });

  const parsed = lines.map((line) => JSON.parse(line));

  expect(parsed).toHaveLength(2);
  expect(parsed[0]).toMatchObject({
    level: "info",
    service: "svc",
    msg: "hello",
    messageId: "1",
  });
  expect(parsed[1]).toMatchObject({ level: "error", err: "boom" });
});

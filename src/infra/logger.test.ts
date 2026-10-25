import { expect, test } from "bun:test";
import { createLogger } from "./logger.ts";

test("writes pino JSON lines with the service, respects level and keeps only safe error fields", () => {
  const lines: string[] = [];
  const log = createLogger(
    { service: "svc", level: "info" },
    { write: (line) => lines.push(line) },
  );
  const failure = Object.assign(new Error("boom"), {
    path: "https://example.com/secret-webhook",
  });

  log.debug("hidden");
  log.info({ messageId: "1" }, "hello");
  log.error({ err: failure }, "failed");

  const parsed = lines.map((line) => JSON.parse(line));

  expect(parsed).toHaveLength(2);
  expect(parsed[0]).toMatchObject({
    level: 30,
    service: "svc",
    msg: "hello",
    messageId: "1",
  });
  expect(parsed[1]).toMatchObject({
    level: 50,
    msg: "failed",
    err: { type: "Error", message: "boom" },
  });
  expect(lines.join("")).not.toContain("secret-webhook");
});

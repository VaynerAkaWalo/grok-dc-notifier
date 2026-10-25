import { expect, test } from "bun:test";
import { createHealthHandler } from "./app.ts";

test("health endpoints follow gateway state", () => {
  const gateway = { connected: false, last: 0 };
  const handler = createHealthHandler(
    {
      isConnected: () => gateway.connected,
      lastActivityAt: () => gateway.last,
    },
    1_000,
    () => 500,
  );
  const get = (path: string) => handler(new Request(`http://x${path}`)).status;

  expect(get("/healthz")).toBe(200);
  expect(get("/readyz")).toBe(503);

  gateway.connected = true;
  gateway.last = -1_000;

  expect(get("/readyz")).toBe(200);
  expect(get("/healthz")).toBe(503);
  expect(get("/other")).toBe(404);
});

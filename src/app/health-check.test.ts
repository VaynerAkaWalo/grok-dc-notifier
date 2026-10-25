import { expect, test } from "bun:test";
import { HealthCheck } from "./health-check.ts";

test("health endpoints follow gateway state", () => {
  const gateway = { connected: false, last: 0 };
  const health = new HealthCheck(
    {
      isConnected: () => gateway.connected,
      lastActivityAt: () => gateway.last,
    },
    1_000,
    () => 500,
  );
  const get = (path: string) =>
    health.handle(new Request(`http://x${path}`)).status;

  expect(get("/healthz")).toBe(200);
  expect(get("/readyz")).toBe(503);

  gateway.connected = true;
  gateway.last = -1_000;

  expect(get("/readyz")).toBe(200);
  expect(get("/healthz")).toBe(503);
  expect(get("/other")).toBe(404);
  expect(
    health.handle(new Request("http://x/healthz", { method: "POST" })).status,
  ).toBe(405);
});

import { expect, test } from "bun:test";
import { GatewaySession } from "./session.ts";

test("tracks READY, sequence and resume target, and resets", () => {
  const session = new GatewaySession();

  expect(session.resumable).toBe(false);
  expect(session.heartbeatSequence).toBeNull();
  expect(session.connectUrl("wss://default")).toBe("wss://default");

  session.ready({
    session_id: "s",
    resume_gateway_url: " wss://resume ",
    user: { id: "9" },
  });
  session.trackSequence(4);
  session.trackSequence(null);

  expect(session.resumable).toBe(true);
  expect(session.botUserId).toBe("9");
  expect(session.heartbeatSequence).toBe(4);
  expect(session.connectUrl("wss://default")).toBe("wss://resume");
  expect(session.resumePayload("t")).toEqual({
    token: "t",
    session_id: "s",
    seq: 4,
  });

  session.reset();

  expect(session.resumable).toBe(false);
  expect(session.connectUrl("wss://default")).toBe("wss://default");
  expect(session.botUserId).toBe("9");
});

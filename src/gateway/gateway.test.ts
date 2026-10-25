import { afterEach, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { silentLogger } from "../infra/logger.ts";
import { FatalGatewayError, GatewayClient, intents } from "./gateway.ts";

interface Conn {
  index: number;
  path: string;
  ws: ServerWebSocket<{ index: number; path: string }>;
  received: { op: number; d: unknown }[];
}

type Script = (conn: Conn, frame: { op: number; d: unknown }) => void;

const servers: { stop(force?: boolean): void }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

// A fake gateway: sends HELLO, ACKs heartbeats (unless ackHeartbeats is false)
// and passes every other frame to the script.
function fakeGateway(
  script: Script,
  options = { ackHeartbeats: true, heartbeatMs: 100 },
) {
  const conns: Conn[] = [];
  const server = Bun.serve<{ index: number; path: string }>({
    port: 0,
    fetch(req, srv) {
      const index = conns.length;

      conns.push({
        index,
        path: new URL(req.url).pathname + new URL(req.url).search,
      } as Conn);

      return srv.upgrade(req, {
        data: { index, path: new URL(req.url).pathname },
      })
        ? undefined
        : new Response("upgrade failed", { status: 400 });
    },
    websocket: {
      open(ws) {
        const conn = conns[ws.data.index] as Conn;

        conn.ws = ws;
        conn.received = [];
        ws.send(
          JSON.stringify({
            op: 10,
            d: { heartbeat_interval: options.heartbeatMs },
          }),
        );
      },
      message(ws, raw) {
        const conn = conns[ws.data.index] as Conn;
        const frame = JSON.parse(String(raw));

        conn.received.push(frame);

        if (frame.op === 1) {
          if (options.ackHeartbeats) {
            ws.send(JSON.stringify({ op: 11 }));
          }

          return;
        }

        script(conn, frame);
      },
    },
  });

  servers.push(server);

  return { conns, url: `ws://localhost:${server.port}` };
}

const send = (conn: Conn, payload: unknown) =>
  conn.ws.send(JSON.stringify(payload));

function client(
  url: string,
  onDispatch: (type: string, data: unknown, bot: string) => void,
) {
  return new GatewayClient({
    token: "t",
    gatewayUrl: `${url}/gw`,
    intents,
    onDispatch,
    log: silentLogger,
    minBackoffMs: 10,
    maxBackoffMs: 20,
  });
}

async function waitFor(check: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;

  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("timed out");
    }

    await Bun.sleep(10);
  }
}

test("identifies, reconnects on op 7 and resumes on resume_gateway_url", async () => {
  const gw = fakeGateway((conn, frame) => {
    if (conn.index === 0 && frame.op === 2) {
      send(conn, {
        op: 0,
        s: 1,
        t: "READY",
        d: {
          session_id: "sess",
          resume_gateway_url: `${gw.url}/resume`,
          user: { id: "999", username: "notifier-bot" },
        },
      });
      send(conn, { op: 0, s: 2, t: "MESSAGE_CREATE", d: { id: "m1" } });
      setTimeout(() => send(conn, { op: 7 }), 250);
    }

    if (conn.index === 1 && frame.op === 6) {
      send(conn, { op: 0, s: 3, t: "RESUMED", d: {} });
      send(conn, { op: 0, s: 4, t: "MESSAGE_CREATE", d: { id: "m2" } });
    }
  });
  const messages: string[] = [];
  const bots: string[] = [];
  const gateway = client(gw.url, (type, data, bot) => {
    if (type === "MESSAGE_CREATE") {
      messages.push((data as { id: string }).id);
      bots.push(bot);
    }
  });
  const stop = new AbortController();
  const running = gateway.run(stop.signal);

  await waitFor(() => messages.length === 2);

  expect(messages).toEqual(["m1", "m2"]);
  expect(bots).toEqual(["999", "999"]);
  expect(gateway.isConnected()).toBe(true);

  const identify = gw.conns[0]?.received.find((f) => f.op === 2)?.d as {
    intents: number;
    token: string;
  };
  const resume = gw.conns[1]?.received.find((f) => f.op === 6)?.d;

  expect(identify.intents).toBe(37377);
  expect(resume).toEqual({ token: "t", session_id: "sess", seq: 2 });
  expect(gw.conns[0]?.path).toStartWith("/gw?");
  expect(gw.conns[1]?.path).toStartWith("/resume?");
  expect(gw.conns[1]?.path).toContain("v=10");

  stop.abort();
  await running;
});

test("treats a missing heartbeat ACK as a zombie connection and resumes", async () => {
  const gw = fakeGateway(
    (conn, frame) => {
      if (frame.op === 2) {
        send(conn, {
          op: 0,
          s: 1,
          t: "READY",
          d: {
            session_id: "sess",
            resume_gateway_url: `${gw.url}/resume`,
            user: { id: "9" },
          },
        });
      }
    },
    { ackHeartbeats: false, heartbeatMs: 50 },
  );
  const gateway = client(gw.url, () => {});
  const stop = new AbortController();
  const running = gateway.run(stop.signal);

  await waitFor(() => (gw.conns[1]?.received?.length ?? 0) > 0);

  expect(gw.conns[1]?.received[0]?.op).toBe(6);

  stop.abort();
  await running;
});

test("re-identifies after a non-resumable INVALID_SESSION", async () => {
  const gw = fakeGateway((conn, frame) => {
    if (conn.index === 0 && frame.op === 2) {
      send(conn, {
        op: 0,
        s: 1,
        t: "READY",
        d: { session_id: "sess", user: { id: "9" } },
      });
      send(conn, { op: 9, d: false });
    }
  });
  const gateway = client(gw.url, () => {});
  const stop = new AbortController();
  const running = gateway.run(stop.signal);

  await waitFor(() => (gw.conns[1]?.received?.length ?? 0) > 0);

  expect(gw.conns[1]?.received[0]?.op).toBe(2);
  expect(gw.conns[1]?.path).toStartWith("/gw?");

  stop.abort();
  await running;
});

test("stops with a clear error on disallowed intents", async () => {
  const gw = fakeGateway((conn, frame) => {
    if (frame.op === 2) {
      conn.ws.close(4014, "Disallowed intent(s).");
    }
  });
  const gateway = client(gw.url, () => {});

  const error = await gateway
    .run(new AbortController().signal)
    .catch((err) => err);

  expect(error).toBeInstanceOf(FatalGatewayError);
  expect(String(error.message)).toContain("Message Content Intent");
});

test("stops on authentication failure", async () => {
  const gw = fakeGateway((conn) =>
    conn.ws.close(4004, "Authentication failed."),
  );
  const gateway = client(gw.url, () => {});

  const error = await gateway
    .run(new AbortController().signal)
    .catch((err) => err);

  expect(error).toBeInstanceOf(FatalGatewayError);
  expect(error.code).toBe(4004);
});

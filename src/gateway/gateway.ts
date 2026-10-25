// Minimal Discord Gateway (v10, JSON) client on Bun's native WebSocket. Keeps
// one session alive with heartbeats, resumes on resume_gateway_url after drops
// and re-identifies when the session cannot be resumed.

import { z } from "zod";
import type { Logger } from "../infra/logger.ts";

// GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
export const intents = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);

const op = {
  dispatch: 0,
  heartbeat: 1,
  identify: 2,
  resume: 6,
  reconnect: 7,
  invalidSession: 9,
  hello: 10,
  heartbeatAck: 11,
} as const;

// Close codes a reconnect cannot fix.
const fatalCodes: Record<number, string> = {
  4004: "authentication failed (bad DISCORD_BOT_TOKEN)",
  4010: "invalid shard",
  4011: "sharding required",
  4012: "invalid API version",
  4013: "invalid intents",
  4014: "disallowed intents (enable Message Content Intent in the Developer Portal)",
};

// The session is gone but a fresh identify may work.
const sessionResetCodes = new Set([4007, 4009]);

// A close code we send ourselves so Discord keeps the session resumable.
const resumableClose = 4000;

export class FatalGatewayError extends Error {
  constructor(
    readonly code: number,
    detail: string,
  ) {
    super(`fatal gateway close ${code}: ${detail}`);
  }
}

export const payloadSchema = z.object({
  op: z.number(),
  d: z.unknown().optional(),
  s: z.number().nullish(),
  t: z.string().nullish(),
});

type Payload = z.infer<typeof payloadSchema>;

export const helloSchema = z.object({
  heartbeat_interval: z.number().positive(),
});

// READY fields are all optional; missing or malformed ones read as undefined
// and the client falls back to empty strings.
export const readySchema = z.object({
  session_id: z.string().optional().catch(undefined),
  resume_gateway_url: z.string().optional().catch(undefined),
  user: z
    .object({
      id: z.string().optional().catch(undefined),
      username: z.string().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

// Parses one text frame; undefined when it is not JSON or not a payload.
export function decodeFrame(raw: string): Payload | undefined {
  let json: unknown;

  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const parsed = payloadSchema.safeParse(json);

  return parsed.success ? parsed.data : undefined;
}

// Receives every dispatch event (including READY). Must not block.
export type DispatchHandler = (
  type: string,
  data: unknown,
  botUserId: string,
) => void;

export interface GatewayOptions {
  token: string;
  gatewayUrl: string;
  intents: number;
  onDispatch: DispatchHandler;
  log: Logger;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  connectTimeoutMs?: number;
}

function withQuery(base: string): string {
  const url = new URL(base);

  url.searchParams.set("v", "10");
  url.searchParams.set("encoding", "json");

  return url.toString();
}

export class GatewayClient {
  private sessionId = "";
  private resumeUrl = "";
  private botUserId = "";
  private seq = 0;
  private connected = false;
  private lastActivity = Date.now();

  constructor(private readonly options: GatewayOptions) {}

  isConnected(): boolean {
    return this.connected;
  }

  lastActivityAt(): number {
    return this.lastActivity;
  }

  // Connects and reconnects until the signal aborts or a fatal close arrives.
  async run(signal: AbortSignal): Promise<void> {
    const minBackoff = this.options.minBackoffMs ?? 1_000;
    const maxBackoff = this.options.maxBackoffMs ?? 60_000;
    let backoff = minBackoff;

    this.lastActivity = Date.now();

    while (!signal.aborted) {
      const startedAt = Date.now();
      const reason = await this.session(signal);

      this.connected = false;

      if (signal.aborted) {
        return;
      }

      if (Date.now() - startedAt > 2 * 60_000) {
        backoff = minBackoff;
      }

      const waitMs = backoff + Math.floor(Math.random() * (backoff / 2));

      this.options.log.warn("gateway disconnected, reconnecting", {
        reason,
        resume: this.sessionId !== "",
        inMs: waitMs,
      });

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, waitMs);

        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });

      backoff = Math.min(backoff * 2, maxBackoff);
    }
  }

  private resetSession() {
    this.sessionId = "";
    this.resumeUrl = "";
    this.seq = 0;
  }

  // Runs one websocket connection. Resolves with a reason when it drops and
  // rejects with FatalGatewayError on close codes a reconnect cannot fix.
  private session(signal: AbortSignal): Promise<string> {
    const resuming = this.sessionId !== "";
    const target =
      resuming && this.resumeUrl ? this.resumeUrl : this.options.gatewayUrl;

    return new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(withQuery(target));
      let ended = false;
      let endReason = "";
      let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
      let acked = true;

      const handshakeTimer = setTimeout(
        () => closeWith(resumableClose, "no HELLO within timeout"),
        this.options.connectTimeoutMs ?? 20_000,
      );

      const cleanup = () => {
        clearTimeout(handshakeTimer);
        clearTimeout(heartbeatTimer);
        signal.removeEventListener("abort", onAbort);
      };

      // Close the socket ourselves; the close event finishes the session.
      const closeWith = (code: number, reason: string) => {
        endReason ||= reason;

        try {
          ws.close(code, reason);
        } catch {
          finish(reason);
        }
      };

      const finish = (reason: string, error?: Error) => {
        if (ended) {
          return;
        }

        ended = true;
        cleanup();

        if (error) {
          reject(error);
        } else {
          resolve(reason);
        }
      };

      const onAbort = () => closeWith(1000, "shutting down");

      signal.addEventListener("abort", onAbort, { once: true });

      const send = (opcode: number, d: unknown) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ op: opcode, d }));
        }
      };

      const heartbeat = () =>
        send(op.heartbeat, this.seq > 0 ? this.seq : null);

      const scheduleHeartbeat = (delayMs: number, intervalMs: number) => {
        heartbeatTimer = setTimeout(() => {
          if (!acked) {
            closeWith(resumableClose, "heartbeat not acknowledged");

            return;
          }

          acked = false;
          heartbeat();
          scheduleHeartbeat(intervalMs, intervalMs);
        }, delayMs);
      };

      ws.addEventListener("message", (event) => {
        const payload = decodeFrame(String(event.data));

        if (!payload) {
          this.options.log.error("undecodable gateway frame");

          return;
        }

        this.lastActivity = Date.now();

        if (typeof payload.s === "number") {
          this.seq = payload.s;
        }

        switch (payload.op) {
          case op.hello: {
            clearTimeout(handshakeTimer);

            const hello = helloSchema.safeParse(payload.d);

            if (!hello.success) {
              closeWith(resumableClose, "bad HELLO");

              return;
            }

            const interval = hello.data.heartbeat_interval;

            if (resuming) {
              send(op.resume, {
                token: this.options.token,
                session_id: this.sessionId,
                seq: this.seq,
              });
            } else {
              send(op.identify, {
                token: this.options.token,
                intents: this.options.intents,
                properties: {
                  os: "linux",
                  browser: "grok-dc-notifier",
                  device: "grok-dc-notifier",
                },
              });
            }

            // First beat after interval * jitter, then every interval.
            scheduleHeartbeat(Math.floor(interval * Math.random()), interval);

            break;
          }
          case op.heartbeatAck:
            acked = true;
            break;
          case op.heartbeat:
            heartbeat();
            break;
          case op.reconnect:
            closeWith(resumableClose, "server requested reconnect");
            break;
          case op.invalidSession: {
            const resumable = payload.d === true;

            if (!resumable) {
              this.resetSession();
            }

            closeWith(
              resumableClose,
              `invalid session (resumable=${resumable})`,
            );

            break;
          }
          case op.dispatch:
            this.dispatch(payload);
            break;
        }
      });

      ws.addEventListener("close", (event) => {
        const fatal = fatalCodes[event.code];

        if (fatal) {
          finish("", new FatalGatewayError(event.code, fatal));

          return;
        }

        if (sessionResetCodes.has(event.code)) {
          this.resetSession();
        }

        finish(endReason || `closed with code ${event.code}`);
      });

      ws.addEventListener("error", () => {
        endReason ||= "websocket error";
      });
    });
  }

  private dispatch(payload: Payload) {
    const type = payload.t ?? "";

    if (type === "READY") {
      const ready = readySchema.catch({}).parse(payload.d);

      this.sessionId = ready.session_id ?? "";
      this.resumeUrl = ready.resume_gateway_url?.trim() ?? "";
      this.botUserId = ready.user?.id ?? "";
      this.connected = true;

      this.options.log.info("gateway ready", {
        botUserId: this.botUserId,
        botUsername: ready.user?.username,
      });
    } else if (type === "RESUMED") {
      this.connected = true;
      this.options.log.info("gateway resumed", { seq: this.seq });
    }

    this.options.onDispatch(type, payload.d, this.botUserId);
  }
}

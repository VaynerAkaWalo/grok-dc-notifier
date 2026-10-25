import type { Logger } from "../infra/logger.ts";
import type { ConnectionStatus } from "./connection-status.ts";
import { Heartbeat } from "./heartbeat.ts";
import {
  CloseCode,
  decodeFrame,
  FatalGatewayError,
  helloSchema,
  Opcode,
  type Payload,
  parseReady,
  sessionEndingCloseCodes,
  unrecoverableCloseCodes,
  withGatewayQuery,
} from "./protocol.ts";
import type { GatewaySession } from "./session.ts";

export type DispatchHandler = (
  eventType: string,
  data: unknown,
  botUserId: string,
) => void;

export interface ConnectionOptions {
  token: string;
  gatewayUrl: string;
  intents: number;
  helloTimeoutMs: number;
  onDispatch: DispatchHandler;
  log: Logger;
}

interface Settlement {
  resolve: (reason: string) => void;
  reject: (error: Error) => void;
}

export class GatewayConnection {
  private readonly ws: WebSocket;
  private readonly resuming: boolean;
  private readonly heartbeat: Heartbeat;
  private readonly helloTimer: ReturnType<typeof setTimeout>;
  private closeReason = "";
  private finished = false;

  private constructor(
    private readonly options: ConnectionOptions,
    private readonly session: GatewaySession,
    private readonly status: ConnectionStatus,
    private readonly signal: AbortSignal,
    private readonly settlement: Settlement,
  ) {
    this.resuming = session.resumable;
    this.heartbeat = new Heartbeat(
      () => this.sendHeartbeat(),
      () =>
        this.close(
          CloseCode.keepSessionResumable,
          "heartbeat not acknowledged",
        ),
    );
    this.ws = new WebSocket(
      withGatewayQuery(session.connectUrl(options.gatewayUrl)),
    );
    this.helloTimer = setTimeout(
      () =>
        this.close(CloseCode.keepSessionResumable, "no HELLO within timeout"),
      options.helloTimeoutMs,
    );
  }

  static open(
    options: ConnectionOptions,
    session: GatewaySession,
    status: ConnectionStatus,
    signal: AbortSignal,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      new GatewayConnection(options, session, status, signal, {
        resolve,
        reject,
      }).listen();
    });
  }

  private readonly onAbort = () =>
    this.close(CloseCode.normal, "shutting down");

  private listen() {
    this.signal.addEventListener("abort", this.onAbort, { once: true });
    this.ws.addEventListener("message", (event) =>
      this.receive(String(event.data)),
    );
    this.ws.addEventListener("close", (event) => this.closed(event.code));
    this.ws.addEventListener("error", () => {
      this.closeReason ||= "websocket error";
    });
  }

  private receive(raw: string) {
    const payload = decodeFrame(raw);

    if (!payload) {
      this.options.log.error("undecodable gateway frame");

      return;
    }

    this.status.markActivity();
    this.session.trackSequence(payload.s);

    switch (payload.op) {
      case Opcode.hello:
        this.hello(payload.d);
        break;
      case Opcode.heartbeatAck:
        this.heartbeat.acknowledge();
        break;
      case Opcode.heartbeat:
        this.sendHeartbeat();
        break;
      case Opcode.reconnect:
        this.close(
          CloseCode.keepSessionResumable,
          "server requested reconnect",
        );
        break;
      case Opcode.invalidSession:
        this.invalidSession(payload.d === true);
        break;
      case Opcode.dispatch:
        this.dispatch(payload);
        break;
    }
  }

  private hello(data: unknown) {
    clearTimeout(this.helloTimer);

    const hello = helloSchema.safeParse(data);

    if (!hello.success) {
      this.close(CloseCode.keepSessionResumable, "bad HELLO");

      return;
    }

    if (this.resuming) {
      this.send(Opcode.resume, this.session.resumePayload(this.options.token));
    } else {
      this.send(
        Opcode.identify,
        this.session.identifyPayload(this.options.token, this.options.intents),
      );
    }

    this.heartbeat.start(hello.data.heartbeat_interval);
  }

  private invalidSession(resumable: boolean) {
    if (!resumable) {
      this.session.reset();
    }

    this.close(
      CloseCode.keepSessionResumable,
      `invalid session (resumable=${resumable})`,
    );
  }

  private dispatch(payload: Payload) {
    const eventType = payload.t ?? "";

    if (eventType === "READY") {
      const ready = parseReady(payload.d);

      this.session.ready(ready);
      this.status.markConnected();
      this.options.log.info(
        {
          botUserId: this.session.botUserId,
          botUsername: ready.user?.username,
        },
        "gateway ready",
      );
    } else if (eventType === "RESUMED") {
      this.status.markConnected();
      this.options.log.info(
        { seq: this.session.lastSequence },
        "gateway resumed",
      );
    }

    this.options.onDispatch(eventType, payload.d, this.session.botUserId);
  }

  private sendHeartbeat() {
    this.send(Opcode.heartbeat, this.session.heartbeatSequence);
  }

  private send(op: number, d: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op, d }));
    }
  }

  private close(code: number, reason: string) {
    this.closeReason ||= reason;

    try {
      this.ws.close(code, reason);
    } catch {
      this.finish(reason);
    }
  }

  private closed(code: number) {
    const unrecoverable = unrecoverableCloseCodes[code];

    if (unrecoverable) {
      this.finish("", new FatalGatewayError(code, unrecoverable));

      return;
    }

    if (sessionEndingCloseCodes.has(code)) {
      this.session.reset();
    }

    this.finish(this.closeReason || `closed with code ${code}`);
  }

  private finish(reason: string, error?: Error) {
    if (this.finished) {
      return;
    }

    this.finished = true;
    clearTimeout(this.helloTimer);
    this.heartbeat.stop();
    this.signal.removeEventListener("abort", this.onAbort);

    if (error) {
      this.settlement.reject(error);
    } else {
      this.settlement.resolve(reason);
    }
  }
}

import type { Logger } from "../infra/logger.ts";
import { Backoff } from "./backoff.ts";
import { type DispatchHandler, GatewayConnection } from "./connection.ts";
import { ConnectionStatus } from "./connection-status.ts";
import { GatewaySession } from "./session.ts";

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

const stableConnectionMs = 2 * 60_000;

export class GatewayClient {
  private readonly session = new GatewaySession();
  private readonly status = new ConnectionStatus();

  constructor(private readonly options: GatewayOptions) {}

  isConnected(): boolean {
    return this.status.isConnected();
  }

  lastActivityAt(): number {
    return this.status.lastActivityAt();
  }

  async run(signal: AbortSignal): Promise<void> {
    const backoff = new Backoff(
      this.options.minBackoffMs ?? 1_000,
      this.options.maxBackoffMs ?? 60_000,
    );

    this.status.markActivity();

    while (!signal.aborted) {
      const startedAt = Date.now();
      const reason = await this.connectOnce(signal);

      this.status.markDisconnected();

      if (signal.aborted) {
        return;
      }

      if (Date.now() - startedAt > stableConnectionMs) {
        backoff.reset();
      }

      const delayMs = backoff.nextDelayMs();

      this.options.log.warn(
        { reason, resume: this.session.resumable, inMs: delayMs },
        "gateway disconnected, reconnecting",
      );

      await this.sleep(delayMs, signal);
    }
  }

  private connectOnce(signal: AbortSignal): Promise<string> {
    return GatewayConnection.open(
      {
        token: this.options.token,
        gatewayUrl: this.options.gatewayUrl,
        intents: this.options.intents,
        helloTimeoutMs: this.options.connectTimeoutMs ?? 20_000,
        onDispatch: this.options.onDispatch,
        log: this.options.log,
      },
      this.session,
      this.status,
      signal,
    );
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);

      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}

import { DiscordRestClient } from "../discord/rest-client.ts";
import { GatewayClient } from "../gateway/client.ts";
import { FatalGatewayError, intents } from "../gateway/protocol.ts";
import type { AppConfig } from "../infra/config/index.ts";
import type { Logger } from "../infra/logger.ts";
import { createRelay } from "../relay/create-relay.ts";
import { Dedupe } from "../relay/dedupe.ts";
import { RateLimiter } from "../relay/rate-limiter.ts";
import { WebhookClient } from "../relay/webhook-client.ts";
import { HealthCheck } from "./health-check.ts";

export const ExitCode = {
  stopped: 0,
  gatewayFailed: 1,
  invalidConfig: 2,
} as const;

export class Application {
  private readonly gateway: GatewayClient;
  private readonly health: HealthCheck;

  constructor(
    private readonly config: AppConfig,
    private readonly log: Logger,
  ) {
    const relay = createRelay({
      allowedUserIds: config.discord.allowedUserIds,
      allowedGuildIds: config.discord.allowedGuildIds,
      api: new DiscordRestClient({ token: config.discord.token }),
      dedupe: new Dedupe(config.relay.dedupeTtlMs),
      limiter: new RateLimiter(config.relay.ratePerMinute),
      negativeTtlMs: config.relay.threadNegativeTtlMs,
      webhook: new WebhookClient({
        url: config.webhook.url,
        authHeader: config.webhook.authHeader,
        timeoutMs: config.webhook.timeoutMs,
      }),
      log,
    });

    this.gateway = new GatewayClient({
      token: config.discord.token,
      gatewayUrl: config.discord.gatewayUrl,
      intents,
      onDispatch: relay.handle,
      log,
    });
    this.health = new HealthCheck(this.gateway, config.health.staleAfterMs);
  }

  async run(): Promise<number> {
    const server = Bun.serve({
      port: this.config.app.port,
      fetch: this.health.handle,
    });
    const shutdown = this.shutdownOnSignals();

    this.log.info(
      {
        port: this.config.app.port,
        allowedUsers: this.config.discord.allowedUserIds.size,
        allowedGuilds: this.config.discord.allowedGuildIds.size,
        ratePerMinute: this.config.relay.ratePerMinute,
      },
      "starting",
    );

    const exitCode = await this.runGateway(shutdown.signal);

    await server.stop();
    this.log.info("stopped");

    return exitCode;
  }

  private shutdownOnSignals(): AbortController {
    const shutdown = new AbortController();

    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.on(signal, () => {
        this.log.info("shutting down");
        shutdown.abort();
      });
    }

    return shutdown;
  }

  private async runGateway(signal: AbortSignal): Promise<number> {
    try {
      await this.gateway.run(signal);

      return ExitCode.stopped;
    } catch (err) {
      const msg =
        err instanceof FatalGatewayError
          ? "gateway stopped"
          : "gateway crashed";

      this.log.error({ err }, msg);

      return ExitCode.gatewayFailed;
    }
  }
}

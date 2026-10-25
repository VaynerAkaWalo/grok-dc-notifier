import { createHealthHandler } from "./app.ts";
import { createRest } from "./discord/rest.ts";
import {
  FatalGatewayError,
  GatewayClient,
  intents,
} from "./gateway/gateway.ts";
import { loadConfig } from "./infra/config.ts";
import { createLogger } from "./infra/logger.ts";
import { Dedupe, Limiter } from "./relay/limits.ts";
import { Relay } from "./relay/relay.ts";

const service = "grok-dc-notifier";
let config: ReturnType<typeof loadConfig>;

try {
  config = loadConfig();
} catch (err) {
  createLogger(service).error("invalid configuration", { err });
  process.exit(2);
}

const log = createLogger(service, config.logLevel);

const relay = new Relay({
  allowedUserIds: config.allowedUserIds,
  allowedGuildIds: config.allowedGuildIds,
  api: createRest({ token: config.discordToken }),
  dedupe: new Dedupe(config.dedupeTtlMs),
  limiter: new Limiter(config.ratePerMinute),
  negativeTtlMs: config.threadNegativeTtlMs,
  webhookUrl: config.webhookUrl,
  webhookAuthHeader: config.webhookAuthHeader,
  webhookTimeoutMs: config.webhookTimeoutMs,
  log,
});

const gateway = new GatewayClient({
  token: config.discordToken,
  gatewayUrl: config.gatewayUrl,
  intents,
  onDispatch: relay.handle,
  log,
});

const server = Bun.serve({
  port: config.port,
  fetch: createHealthHandler(gateway, config.staleAfterMs),
});

const shutdown = new AbortController();

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    log.info("shutting down");
    shutdown.abort();
  });
}

log.info("starting", {
  port: config.port,
  allowedUsers: config.allowedUserIds.size,
  allowedGuilds: config.allowedGuildIds.size,
  ratePerMinute: config.ratePerMinute,
});

let exitCode = 0;

try {
  await gateway.run(shutdown.signal);
} catch (err) {
  exitCode = 1;
  log.error(
    err instanceof FatalGatewayError ? "gateway stopped" : "gateway crashed",
    { err },
  );
}

await server.stop();
log.info("stopped");
process.exit(exitCode);

import { Application, ExitCode } from "./app/application.ts";
import { type AppConfig, loadConfig } from "./infra/config/index.ts";
import { createLogger } from "./infra/logger.ts";

const service = "grok-dc-notifier";

let config: AppConfig;

try {
  config = loadConfig();
} catch (err) {
  createLogger({ service, level: "info" }).error(
    { err },
    "invalid configuration",
  );
  process.exit(ExitCode.invalidConfig);
}

const log = createLogger({
  service: config.app.name,
  level: config.logging.level,
});

process.exit(await new Application(config, log).run());

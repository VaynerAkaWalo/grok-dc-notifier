import { type DestinationStream, type Logger, pino } from "pino";

export type { Logger };

export const logLevels = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
] as const;

export type LogLevel = (typeof logLevels)[number];

export interface LoggerOptions {
  service: string;
  level: LogLevel;
}

const errorWithoutExtraProperties = (err: Error) => ({
  type: err.name,
  message: err.message,
  stack: err.stack,
});

export function createLogger(
  options: LoggerOptions,
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      level: options.level,

      base: {
        service: options.service,
      },

      serializers: {
        err: errorWithoutExtraProperties,
      },
    },
    destination,
  );
}

export const silentLogger: Logger = pino({ level: "silent" });

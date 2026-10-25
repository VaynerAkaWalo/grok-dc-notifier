// Tiny JSON-lines logger. Never pass message contents or secrets as fields.

const levels = { debug: 20, info: 30, warn: 40, error: 50 } as const;

export type Level = keyof typeof levels;
export type Fields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
}

export function createLogger(
  service: string,
  level: Level = "info",
  write: (line: string) => void = (line) => process.stdout.write(line),
): Logger {
  const min = levels[level];

  const emit = (lvl: Level, msg: string, fields?: Fields) => {
    if (levels[lvl] < min) {
      return;
    }

    const err = fields?.err;
    const extra =
      err instanceof Error ? { ...fields, err: err.message } : fields;

    write(
      `${JSON.stringify({ level: lvl, time: new Date().toISOString(), service, msg, ...extra })}\n`,
    );
  };

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}

export const silentLogger: Logger = createLogger("test", "error", () => {});

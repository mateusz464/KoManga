// Structured logging behind a port so services/middleware depend on the
// interface, not the logging library (CLAUDE.md §3/§11). The concrete `pino`
// implementation lives in adapters/logging and never crosses this boundary.

// The standard pino severity set; `silent` disables output. LOG_LEVEL in config
// is validated against this set (mirrors IMAGE_EINK_FORMAT).
export type LogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal"
  | "silent";

// Optional structured fields merged into the JSON log line (e.g. { mangaId }).
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

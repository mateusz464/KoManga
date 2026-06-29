import { pino, type Logger as PinoLogger } from "pino";
import { Writable } from "node:stream";
import type {
  Logger,
  LogFields,
  LogLevel,
} from "../../services/ports/logger.js";

// pino redacts these paths to the censor below. Covers the single-user
// Authorization header wherever a request-shaped object is logged (e.g. the
// pino-http request log, or a service logging `{ req }`).
export const REDACT_PATHS: readonly string[] = [
  "req.headers.authorization",
  "headers.authorization",
  "authorization",
];

export const REDACTED = "[Redacted]";

// `redact` only scrubs known paths. The single-user token can also reach a line
// as a bare field value or embedded in a message string, so we additionally
// scrub the serialized bytes: any literal occurrence of the secret is replaced
// before the line leaves the process (CLAUDE.md §5/§9 — the credential is never
// logged). Forwarding synchronously (not via `pipe`) keeps the first write
// observable in the same tick, which adapter tests rely on.
class ScrubStream extends Writable {
  constructor(
    private readonly secret: string,
    private readonly target: NodeJS.WritableStream,
  ) {
    super();
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const text = chunk.toString();
    this.target.write(
      this.secret ? text.split(this.secret).join(REDACTED) : text,
    );
    callback();
  }
}

export interface PinoLoggerOptions {
  readonly level: LogLevel;
  // The single-user secret, scrubbed from every line.
  readonly authToken: string;
  // Destination for the JSON lines; defaults to stdout (Alloy parses JSON).
  // Tests inject a capture stream.
  readonly stream?: NodeJS.WritableStream;
}

// Builds the configured concrete pino instance — the only place the pino type is
// constructed. Shared by the Logger-port adapter and the http request logger so
// both inherit the same level + redaction.
export function createPino(options: PinoLoggerOptions): PinoLogger {
  const destination = new ScrubStream(
    options.authToken,
    options.stream ?? process.stdout,
  );
  return pino(
    {
      level: options.level,
      redact: { paths: [...REDACT_PATHS], censor: REDACTED },
    },
    destination,
  );
}

export function createPinoLogger(options: PinoLoggerOptions): Logger {
  const log = createPino(options);
  // pino's call shape is (mergingObject, message); the port's is (message,
  // fields). Map between them so the library type never crosses the boundary.
  const emit =
    (level: "debug" | "info" | "warn" | "error") =>
    (message: string, fields?: LogFields): void => {
      log[level](fields ?? {}, message);
    };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}

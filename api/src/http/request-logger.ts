import type { RequestHandler } from "express";
import { pinoHttp } from "pino-http";
import {
  createPino,
  type PinoLoggerOptions,
} from "../adapters/logging/pino-logger.js";

// Edge request logging: one structured line per request (method, path, status,
// latency). It runs on the shared pino instance so it inherits the same level
// and redaction — the Authorization header and the token value never appear.
export function createRequestLogger(
  options: PinoLoggerOptions,
): RequestHandler {
  const middleware = pinoHttp({ logger: createPino(options) });
  // pino-http types its middleware against node's IncomingMessage/ServerResponse;
  // express's Request/Response extend those, so it is a valid RequestHandler.
  return middleware as unknown as RequestHandler;
}

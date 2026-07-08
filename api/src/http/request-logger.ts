import type { RequestHandler } from "express";
import { pinoHttp } from "pino-http";
import {
  createPino,
  type PinoLoggerOptions,
} from "../adapters/logging/pino-logger.js";

// Runs on the shared pino instance so it inherits the same redaction — the
// Authorization header and token value never appear in a request line.
export function createRequestLogger(
  options: PinoLoggerOptions,
): RequestHandler {
  const middleware = pinoHttp({
    logger: createPino(options),
    // /health is polled on a short interval by the container healthcheck and
    // uptime monitoring; logging every hit drowns real request traffic.
    autoLogging: { ignore: (req) => req.url === "/health" },
  });
  // pino-http types its middleware against node's IncomingMessage/ServerResponse;
  // express's Request/Response extend those, so it is a valid RequestHandler.
  return middleware as unknown as RequestHandler;
}

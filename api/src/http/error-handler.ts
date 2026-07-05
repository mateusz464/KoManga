import type { ErrorRequestHandler, RequestHandler } from "express";
import { ApiError } from "./errors.js";
import type { Logger } from "../services/ports/logger.js";

interface ErrorBody {
  error: { code: string; message: string };
}

function envelope(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

// ApiErrors map straight to the envelope; an unexpected error is logged in full
// server-side while the client only ever sees a safe 500 (CLAUDE.md §6).
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (err instanceof ApiError) {
      res.status(err.status).json(envelope(err.code, err.message));
      return;
    }

    logger.error("Unhandled error", { err });
    res.status(500).json(envelope("INTERNAL", "Internal Server Error"));
  };
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(envelope("NOT_FOUND", "Resource not found"));
};

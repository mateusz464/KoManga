import type { ErrorRequestHandler, RequestHandler } from "express";
import { ApiError } from "./errors.js";

// Centralised error mapping + 404 fallback (CLAUDE.md §6). Typed ApiErrors map
// to their status + the standard envelope; anything else becomes a generic 500
// that never leaks the underlying message or stack.

interface ErrorBody {
  error: { code: string; message: string };
}

function envelope(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json(envelope(err.code, err.message));
    return;
  }

  // Unknown/unexpected error: log server-side, return a safe generic 500.
  console.error(err);
  res.status(500).json(envelope("INTERNAL", "Internal Server Error"));
};

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(envelope("NOT_FOUND", "Resource not found"));
};

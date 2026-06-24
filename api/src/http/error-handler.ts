import type { ErrorRequestHandler, RequestHandler } from "express";

// Centralised error mapping + 404 fallback (CLAUDE.md §6). Typed ApiErrors map
// to their status + the standard envelope; anything else becomes a generic 500
// that never leaks the underlying message or stack.
//
// STUB for API-104: both handlers fall through without producing the envelope,
// so the API-104 tests fail (red). API-105 implements the mapping.

export const errorHandler: ErrorRequestHandler = (_err, _req, _res, next) => {
  next();
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next();
};

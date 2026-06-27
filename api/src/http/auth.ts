import type { RequestHandler } from "express";
import { UnauthorizedError } from "./errors.js";

// Single-user auth middleware (CLAUDE.md §9). Every /api/* route requires the
// shared secret presented as `Authorization: Bearer <token>`. A bearer token in
// a header carries no device identity, so the scheme is single-user but
// multi-client (RFC §13). Missing, malformed, or wrong credentials are rejected
// here at the edge — before any downstream handler runs — as a 401 mapped by the
// central error handler. The secret comes from config, never hardcoded.
export function requireAuth(token: string): RequestHandler {
  return (req, _res, next) => {
    const header = req.get("authorization");
    const expected = `Bearer ${token}`;

    if (header !== expected) {
      next(new UnauthorizedError("Missing or invalid credentials"));
      return;
    }

    next();
  };
}

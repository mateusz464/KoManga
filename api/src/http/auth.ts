import type { RequestHandler } from "express";
import { UnauthorizedError } from "./errors.js";

// A Bearer token in a header carries no device identity, so the single shared
// secret authenticates any client (single-user, multi-client — RFC §13).
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

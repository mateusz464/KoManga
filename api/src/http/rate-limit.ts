import type { Request, RequestHandler } from "express";
import { RateLimitedError } from "./errors.js";

export interface RateLimitOptions {
  readonly limit: number;
  readonly windowMs: number;
  readonly clock?: () => number;
  // The auth scheme is single-user/multi-client, so a shared token can't
  // distinguish clients; network identity (req.ip) does.
  readonly clientKey?: (req: Request) => string;
}

// Fixed-window counter: a client's window starts at its first request and
// resets once the clock has moved past windowMs.
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { limit, windowMs } = options;
  const clock = options.clock ?? Date.now;
  const clientKey = options.clientKey ?? ((req) => req.ip ?? "anonymous");

  interface Window {
    count: number;
    startedAt: number;
  }
  const windows = new Map<string, Window>();

  return (req, _res, next) => {
    const key = clientKey(req);
    const now = clock();
    const current = windows.get(key);

    if (!current || now - current.startedAt >= windowMs) {
      windows.set(key, { count: 1, startedAt: now });
      next();
      return;
    }

    if (current.count >= limit) {
      next(new RateLimitedError("Too many requests"));
      return;
    }

    current.count += 1;
    next();
  };
}

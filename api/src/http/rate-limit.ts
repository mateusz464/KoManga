import type { Request } from "express";

// Per-client rate-limiting contract (CLAUDE.md §9, RFC §9). This module defines
// the shape API-703 pins; the `rateLimit()` middleware factory that consumes it
// is implemented in API-704. Until then nothing is mounted, so the enforcement
// assertions in test/http/rate-limit.test.ts stay red.
//
// Decisions pinned here:
//   - Limit + window are configurable (the two acceptance criteria), supplied by
//     construction from config — never read from env in the middleware.
//   - "Per-client": requests are counted per `clientKey(req)`, defaulting to the
//     source IP (`req.ip`). The auth scheme is single-user/multi-client so a
//     shared token can't distinguish clients; the network identity does.
//   - Over the limit within a window → 429 with the standard error envelope
//     `{ error: { code: "RATE_LIMITED", message } }`, rejected at the edge before
//     any downstream port is touched (same discipline as the auth middleware).
//   - `/health` is never rate-limited (only `/api/*` is guarded).
//   - `clock` is injectable so window expiry is deterministic in tests (the same
//     DI used by the session cache), defaulting to `Date.now`.
export interface RateLimitOptions {
  // Max requests permitted per client within one window.
  readonly limit: number;
  // Window length in milliseconds; the per-client allowance refreshes after it.
  readonly windowMs: number;
  // Time source, injectable for deterministic tests. Defaults to `Date.now`.
  readonly clock?: () => number;
  // Per-client identity. Defaults to the request's source IP (`req.ip`).
  readonly clientKey?: (req: Request) => string;
}

// In-memory implementation of the SessionCache port (RFC §5, CLAUDE.md §7).
//
// STUB for the API-405 [TEST] ticket — the contract is exercised by
// test/adapters/cache/session-cache.test.ts, which stays red until API-406
// implements the real behaviour. Methods throw on purpose so every behavioural
// assertion runs and fails.

import type {
  CachedPage,
  SessionCache,
} from "../../services/ports/session-cache.js";
import type { ImageProfile } from "../../services/ports/image-processor.js";

/**
 * Tunable bounds + clock, supplied by construction (DI from {@link Config.cache}
 * at the composition root). The clock is injectable so TTL expiry is testable
 * without real time.
 */
export interface InMemorySessionCacheOptions {
  readonly maxBytes: number;
  readonly ttlMs: number;
  /** Returns the current time in ms. Defaults to `Date.now`. */
  readonly clock?: () => number;
}

const NOT_IMPLEMENTED = "InMemorySessionCache not implemented (API-406)";

export class InMemorySessionCache implements SessionCache {
  constructor(private readonly options: InMemorySessionCacheOptions) {}

  get(_pageId: string, _profile: ImageProfile): CachedPage | undefined {
    throw new Error(NOT_IMPLEMENTED);
  }

  set(_pageId: string, _profile: ImageProfile, _page: CachedPage): void {
    throw new Error(NOT_IMPLEMENTED);
  }
}

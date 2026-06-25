// Port (interface) for the ephemeral session cache (RFC §5, CLAUDE.md §7).
//
// Holds processed pages for the current reading session, keyed by page id +
// profile — so the `raw` and `eink` renderings of the same page are distinct
// entries. Bounded by total size and per-entry TTL, and pruned aggressively;
// it must never touch the persistent CBZ download store.
//
// Services depend on this interface, never a concrete adapter, so it can be
// mocked in upstream tests (API-407) and swapped (e.g. for an out-of-process
// cache) without changing callers.

import type { ImageProfile } from "./image-processor.js";

/** A processed page held in the cache — the bytes plus how to serve them. */
export interface CachedPage {
  readonly bytes: Buffer;
  readonly contentType: string;
}

export interface SessionCache {
  /**
   * Returns the cached page for (pageId, profile), or `undefined` on a miss or
   * if the entry has expired. Expired entries are never served.
   */
  get(pageId: string, profile: ImageProfile): CachedPage | undefined;

  /**
   * Stores a processed page under (pageId, profile). May trigger size-bound
   * eviction of older entries so the cache stays within its byte budget.
   */
  set(pageId: string, profile: ImageProfile, page: CachedPage): void;
}

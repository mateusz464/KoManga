// Ephemeral cache of processed pages, keyed by page id + profile so `raw` and
// `eink` of one page are distinct entries (RFC §5, CLAUDE.md §7). Never touches
// the persistent CBZ store.

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

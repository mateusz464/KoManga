// Ephemeral cache of processed pages, keyed by page id + profile so `raw` and
// `eink` of one page are distinct entries (RFC §5, CLAUDE.md §7). Never touches
// the persistent CBZ store.

import type { ImageProfile } from "./image-processor.js";

export interface CachedPage {
  readonly bytes: Buffer;
  readonly contentType: string;
}

export interface SessionCache {
  // Misses and expired entries both return undefined; expired entries are never served.
  get(pageId: string, profile: ImageProfile): CachedPage | undefined;
  set(pageId: string, profile: ImageProfile, page: CachedPage): void;
}

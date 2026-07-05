import type { ImageProfile } from "./image-processor.js";

export interface CachedPage {
  readonly bytes: Buffer;
  readonly contentType: string;
}

export interface SessionCache {
  // Expired entries return undefined, indistinguishable from a miss.
  get(pageId: string, profile: ImageProfile): CachedPage | undefined;
  set(pageId: string, profile: ImageProfile, page: CachedPage): void;
}

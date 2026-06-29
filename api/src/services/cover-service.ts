import type { ImageProcessor, ImageProfile } from "./ports/image-processor.js";
import type { SessionCache } from "./ports/session-cache.js";
import type { SuwayomiClient } from "./ports/suwayomi-client.js";

export interface ServedCover {
  readonly bytes: Buffer;
  readonly contentType: string;
}

// Covers are served through the same profile-negotiated, cached image path as
// chapter pages (RFC §5/§6): session cache → on miss fetch + process + store.
// Entries are keyed `cover:<mangaId>` so they can never collide with the
// `<chapterId>:<index>` page ids that share the session cache.
export class CoverService {
  constructor(
    private readonly suwayomi: SuwayomiClient,
    private readonly imageProcessor: ImageProcessor,
    private readonly sessionCache: SessionCache,
  ) {}

  async getCover(mangaId: string, profile: ImageProfile): Promise<ServedCover> {
    const key = cacheKey(mangaId);
    const cached = this.sessionCache.get(key, profile);
    if (cached !== undefined) {
      return cached;
    }

    const source = await this.suwayomi.fetchCover(mangaId);
    const processed = await this.imageProcessor.process(source, profile);
    this.sessionCache.set(key, profile, processed);
    return processed;
  }
}

function cacheKey(mangaId: string): string {
  return `cover:${mangaId}`;
}

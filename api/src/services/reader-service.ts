import type { ImageProcessor, ImageProfile } from "./ports/image-processor.js";
import type { CbzBuilder } from "./ports/cbz-builder.js";
import type { CachedPage, SessionCache } from "./ports/session-cache.js";
import type { SuwayomiClient } from "./ports/suwayomi-client.js";
import { mapWithConcurrency } from "./map-with-concurrency.js";

const CBZ_CONTENT_TYPE = "application/vnd.comicbook+zip";

export interface ReaderCbz {
  readonly bytes: Buffer;
  readonly contentType: string;
}

// The transient reader path (RFC §5.2): builds a chapter's eink CBZ into the
// ephemeral session cache. It never touches the persistent download store, so
// merely reading a chapter doesn't make it appear as a download — that stays the
// job of DownloadService.
export class ReaderService {
  constructor(
    private readonly suwayomi: SuwayomiClient,
    private readonly imageProcessor: ImageProcessor,
    private readonly cbzBuilder: CbzBuilder,
    private readonly sessionCache: SessionCache,
    private readonly pageConcurrency: number,
  ) {}

  async readCbz(chapterId: string, profile: ImageProfile): Promise<ReaderCbz> {
    const cacheKey = `${chapterId}:cbz`;
    const cached = this.sessionCache.get(cacheKey, profile);
    if (cached !== undefined) {
      return cached;
    }

    // Resolve the chapter's page URLs once, then fetch + process pages with
    // bounded concurrency. Per-page resolution would issue an upstream round-trip
    // per page (the N+1); fetching serially would sum every page's origin latency
    // — either blows the client's socket timeout on a cold read (API-915/916).
    const pageUrls = await this.suwayomi.fetchPageUrls(chapterId);
    const pages = await mapWithConcurrency(
      pageUrls,
      this.pageConcurrency,
      async (url) => {
        const source = await this.suwayomi.fetchPageBytes(url);
        return this.imageProcessor.process(source, profile);
      },
    );

    const bytes = await this.cbzBuilder.build(pages);
    const built: CachedPage = { bytes, contentType: CBZ_CONTENT_TYPE };
    this.sessionCache.set(cacheKey, profile, built);
    return built;
  }
}

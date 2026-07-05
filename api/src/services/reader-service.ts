import type { ImageProcessor, ImageProfile } from "./ports/image-processor.js";
import type { CbzBuilder, CbzPage } from "./ports/cbz-builder.js";
import type { CachedPage, SessionCache } from "./ports/session-cache.js";
import type { SuwayomiClient } from "./ports/suwayomi-client.js";

const CBZ_CONTENT_TYPE = "application/vnd.comicbook+zip";

export interface ReaderCbz {
  readonly bytes: Buffer;
  readonly contentType: string;
}

// The transient reader path (RFC §5.2): builds + serves a chapter's eink CBZ for
// reading and caches it in the *ephemeral* session cache. Records nothing — it
// never touches the persistent download store/repository, so merely reading a
// chapter doesn't make it appear as a download. Explicit downloads
// (DownloadService) remain the only persisted, listed path.
export class ReaderService {
  constructor(
    private readonly suwayomi: SuwayomiClient,
    private readonly imageProcessor: ImageProcessor,
    private readonly cbzBuilder: CbzBuilder,
    private readonly sessionCache: SessionCache,
  ) {}

  async readCbz(chapterId: string, profile: ImageProfile): Promise<ReaderCbz> {
    // Cache the whole archive under a chapter-scoped key + profile so a re-read
    // is a hit (no refetch/reprocess/rebuild); raw/eink stay distinct entries.
    const cacheKey = `${chapterId}:cbz`;
    const cached = this.sessionCache.get(cacheKey, profile);
    if (cached !== undefined) {
      return cached;
    }

    // Resolve the chapter's page URLs once, then fetch + process each; re-running
    // resolution per page would issue an upstream page-resolution round-trip per
    // page (the N+1 that blows the client's socket timeout on a cold read).
    const pageUrls = await this.suwayomi.fetchPageUrls(chapterId);

    const pages: CbzPage[] = [];
    for (const url of pageUrls) {
      const source = await this.suwayomi.fetchPageBytes(url);
      pages.push(await this.imageProcessor.process(source, profile));
    }

    const bytes = await this.cbzBuilder.build(pages);
    const built: CachedPage = { bytes, contentType: CBZ_CONTENT_TYPE };
    this.sessionCache.set(cacheKey, profile, built);
    return built;
  }
}

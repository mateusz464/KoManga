import type { ImageProcessor, ImageProfile } from "./ports/image-processor.js";
import type { SessionCache } from "./ports/session-cache.js";
import type { PageRef, SuwayomiClient } from "./ports/suwayomi-client.js";

/** A page ready to serve: the processed bytes plus how to type the response. */
export interface ServedPage {
  readonly bytes: Buffer;
  readonly contentType: string;
}

// Business logic for the single-page endpoint — the reading critical path
// (RFC §5/§6). It integrates the three ports: look the page up in the session
// cache (keyed by id + profile); on a miss, fetch the source from Suwayomi,
// process it under the requested profile, store the result, and serve it. On a
// hit the upstream is short-circuited entirely. After serving, it warms the next
// window of pages in the background (prefetch). Knows nothing about Express.
export class PageService {
  constructor(
    private readonly suwayomi: SuwayomiClient,
    private readonly imageProcessor: ImageProcessor,
    private readonly sessionCache: SessionCache,
    // Background-prefetch window (RFC §5): after serving a page, warm the next
    // `prefetchWindow` pages of the same chapter into the cache without blocking
    // the response. 0 disables prefetch. The window is configurable, wired from
    // Config.prefetch.window at the composition root.
    private readonly prefetchWindow = 0,
  ) {}

  async getPage(pageId: string, profile: ImageProfile): Promise<ServedPage> {
    const served = await this.serve(pageId, profile);
    // Fire-and-forget: the reader's response must never wait on prefetch (RFC
    // §5). Errors are swallowed inside prefetch(); guard here too so a synchronous
    // throw can't surface as an unhandled rejection.
    void this.prefetch(pageId, profile).catch(() => {});
    return served;
  }

  // Serve a single page: cache hit short-circuits the upstream; a miss fetches,
  // processes, and stores before returning.
  private async serve(
    pageId: string,
    profile: ImageProfile,
  ): Promise<ServedPage> {
    const cached = this.sessionCache.get(pageId, profile);
    if (cached !== undefined) {
      return cached;
    }

    const source = await this.suwayomi.fetchPage(parsePageId(pageId));
    const processed = await this.imageProcessor.process(source, profile);
    this.sessionCache.set(pageId, profile, processed);
    return processed;
  }

  // Warm the next `prefetchWindow` pages of the same chapter into the cache,
  // under the same profile, bounded by the chapter's page count so we never
  // request past the last page. Already-cached pages are skipped. Runs in the
  // background; any upstream/processing failure for a prefetched page is
  // swallowed — prefetch is best-effort and must not affect the served page.
  private async prefetch(pageId: string, profile: ImageProfile): Promise<void> {
    if (this.prefetchWindow <= 0) {
      return;
    }

    const { chapterId, pageIndex } = parsePageId(pageId);
    let lastIndex: number;
    try {
      lastIndex = (await this.suwayomi.getChapterPageCount(chapterId)) - 1;
    } catch {
      return; // can't determine bounds — skip prefetch entirely
    }

    const end = Math.min(pageIndex + this.prefetchWindow, lastIndex);
    for (let index = pageIndex + 1; index <= end; index++) {
      await this.warm(`${chapterId}:${index}`, profile);
    }
  }

  // Fetch → process → store one page, unless it is already cached. Errors are
  // swallowed: a failed prefetch must not surface.
  private async warm(pageId: string, profile: ImageProfile): Promise<void> {
    if (this.sessionCache.get(pageId, profile) !== undefined) {
      return;
    }
    try {
      const source = await this.suwayomi.fetchPage(parsePageId(pageId));
      const processed = await this.imageProcessor.process(source, profile);
      this.sessionCache.set(pageId, profile, processed);
    } catch {
      // best-effort — ignore
    }
  }
}

// Page ids are "<chapterId>:<index>" (0-based) as minted by the chapter
// page-list endpoint (API-402); split them back into the PageRef the Suwayomi
// client expects. The chapter id may itself be numeric, so split on the last
// colon.
function parsePageId(pageId: string): PageRef {
  const sep = pageId.lastIndexOf(":");
  return {
    chapterId: pageId.slice(0, sep),
    pageIndex: Number(pageId.slice(sep + 1)),
  };
}

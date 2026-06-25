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
// hit the upstream is short-circuited entirely. Knows nothing about Express.
export class PageService {
  constructor(
    private readonly suwayomi: SuwayomiClient,
    private readonly imageProcessor: ImageProcessor,
    private readonly sessionCache: SessionCache,
    // Background-prefetch window (RFC §5): after serving a page, warm the next
    // `prefetchWindow` pages of the same chapter into the cache without blocking
    // the response. 0 disables prefetch. The window is configurable, wired from
    // Config.prefetch.window at the composition root. The prefetch behaviour is
    // implemented in API-410 — this is the scaffold that lets the API-409 tests
    // construct the service and fail red.
    private readonly prefetchWindow = 0,
  ) {}

  async getPage(pageId: string, profile: ImageProfile): Promise<ServedPage> {
    const cached = this.sessionCache.get(pageId, profile);
    if (cached !== undefined) {
      return cached;
    }

    const source = await this.suwayomi.fetchPage(parsePageId(pageId));
    const processed = await this.imageProcessor.process(source, profile);
    this.sessionCache.set(pageId, profile, processed);
    return processed;
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

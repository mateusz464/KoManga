import type { ImageProcessor, ImageProfile } from "./ports/image-processor.js";
import type { SessionCache } from "./ports/session-cache.js";
import type { PageRef, SuwayomiClient } from "./ports/suwayomi-client.js";

export interface ServedPage {
  readonly bytes: Buffer;
  readonly contentType: string;
}

// The reading critical path (RFC §5/§6): session cache → on miss fetch + process
// + store; after serving, warm the next window of pages in the background.
export class PageService {
  constructor(
    private readonly suwayomi: SuwayomiClient,
    private readonly imageProcessor: ImageProcessor,
    private readonly sessionCache: SessionCache,
    // 0 disables prefetch; wired from Config.prefetch.window.
    private readonly prefetchWindow = 0,
  ) {}

  async getPage(pageId: string, profile: ImageProfile): Promise<ServedPage> {
    const served = await this.serve(pageId, profile);
    // Fire-and-forget: the reader's response must never wait on prefetch (RFC §5).
    // The .catch guards against a synchronous throw becoming an unhandled rejection.
    void this.prefetch(pageId, profile).catch(() => {});
    return served;
  }

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

  // Warm the next `prefetchWindow` pages of the same chapter, bounded by the
  // page count so we never request past the last page. Best-effort.
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

// Page ids are "<chapterId>:<index>"; split on the LAST colon, as the chapter id
// may itself contain colons.
function parsePageId(pageId: string): PageRef {
  const sep = pageId.lastIndexOf(":");
  return {
    chapterId: pageId.slice(0, sep),
    pageIndex: Number(pageId.slice(sep + 1)),
  };
}

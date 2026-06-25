import type { SuwayomiClient } from "./ports/suwayomi-client.js";

export interface ChapterPages {
  readonly pageCount: number;
  /**
   * One id per page, ordered from the first page. Each id is `<chapterId>:<index>`
   * (0-based) — the API-facing handle a client passes to `GET /api/page/:id`. The
   * list is metadata only; no image data is fetched here (RFC §6).
   */
  readonly pages: readonly string[];
}

// Business logic for the chapter page list. Knows nothing about Express; it asks
// the SuwayomiClient port for the page count and synthesises the per-page ids the
// API exposes. Unknown chapters surface as the port's NotFoundError.
export class ChapterService {
  constructor(private readonly suwayomi: SuwayomiClient) {}

  async getPages(chapterId: string): Promise<ChapterPages> {
    const pageCount = await this.suwayomi.getChapterPageCount(chapterId);
    const pages = Array.from(
      { length: pageCount },
      (_, index) => `${chapterId}:${index}`,
    );
    return { pageCount, pages };
  }
}

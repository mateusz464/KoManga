import type { SuwayomiClient } from "./ports/suwayomi-client.js";

export interface ChapterPages {
  readonly pageCount: number;
  // One id per page, `<chapterId>:<index>` (0-based) — the handle for GET /api/page/:id.
  readonly pages: readonly string[];
}

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

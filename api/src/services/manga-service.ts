import type {
  Chapter,
  MangaDetails,
  SuwayomiClient,
} from "./ports/suwayomi-client.js";

// Reading direction is metadata the API owns (RFC §6), not Suwayomi's.
export type ReadingDirection = "rtl" | "ltr";

export interface MangaView {
  readonly manga: MangaDetails;
  readonly chapters: readonly Chapter[];
  readonly readingDirection: ReadingDirection;
}

export class MangaService {
  constructor(private readonly suwayomi: SuwayomiClient) {}

  async getManga(mangaId: string): Promise<MangaView> {
    // Refresh policy (API-904): always trigger a live source chapter-fetch on
    // open, rather than reading Suwayomi's stored list (`listChapters`). This
    // guarantees a freshly-searched manga returns its chapters on first open
    // (the API-903 regression) and keeps ongoing series current as new chapters
    // are published. Trade-off: every details open costs a live source scrape,
    // so it is slower than a stored read — acceptable for a single-user reader
    // where correct, up-to-date chapter lists matter more than open latency.
    const [manga, chapters] = await Promise.all([
      this.suwayomi.getMangaDetails(mangaId),
      this.suwayomi.fetchChapters(mangaId),
    ]);

    const ordered = [...chapters].sort(
      (a, b) => a.chapterNumber - b.chapterNumber,
    );

    return { manga, chapters: ordered, readingDirection: "rtl" };
  }
}

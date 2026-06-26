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
    const [manga, chapters] = await Promise.all([
      this.suwayomi.getMangaDetails(mangaId),
      this.suwayomi.listChapters(mangaId),
    ]);

    const ordered = [...chapters].sort(
      (a, b) => a.chapterNumber - b.chapterNumber,
    );

    return { manga, chapters: ordered, readingDirection: "rtl" };
  }
}

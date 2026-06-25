import type {
  Chapter,
  MangaDetails,
  SuwayomiClient,
} from "./ports/suwayomi-client.js";

// Reading direction is metadata the API owns (RFC §6), not something Suwayomi
// supplies. Manga is right-to-left by default.
export type ReadingDirection = "rtl" | "ltr";

export interface MangaView {
  readonly manga: MangaDetails;
  readonly chapters: readonly Chapter[];
  readonly readingDirection: ReadingDirection;
}

// Business logic for the manga detail view. Knows nothing about Express; it
// combines the two SuwayomiClient port calls (details + chapters), imposes
// chapter ordering, and attaches the API-owned reading direction.
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

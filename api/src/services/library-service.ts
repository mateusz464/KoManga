import type {
  LibraryEntry,
  LibraryRepository,
} from "./ports/library-repository.js";
import type { ReadingProgressRepository } from "./ports/reading-progress-repository.js";
import type { Chapter, SuwayomiClient } from "./ports/suwayomi-client.js";

// Computed server-side so a client renders the continue target without a
// per-row progress + chapter-list fan-out (RFC §13, CLAUDE.md §8).
export interface EnrichedLibraryEntry extends LibraryEntry {
  readonly nextChapter: { readonly id: string; readonly number: number } | null;
  readonly caughtUp: boolean;
}

export class LibraryService {
  constructor(
    private readonly repository: LibraryRepository,
    private readonly progressRepository: ReadingProgressRepository,
    private readonly suwayomi: SuwayomiClient,
  ) {}

  async list(): Promise<EnrichedLibraryEntry[]> {
    return Promise.all(this.repository.list().map((e) => this.enrich(e)));
  }

  private async enrich(entry: LibraryEntry): Promise<EnrichedLibraryEntry> {
    const chapters = [
      ...(await this.suwayomi.listChapters(entry.mangaId)),
    ].sort((a, b) => a.chapterNumber - b.chapterNumber);
    const progress = this.progressRepository.get(entry.mangaId);
    return {
      ...entry,
      ...continueTarget(chapters, progress?.chapterId, progress?.page),
    };
  }

  // Idempotent at the repository: re-following keeps the original row.
  follow(entry: LibraryEntry): LibraryEntry {
    this.repository.add(entry);
    return entry;
  }

  unfollow(mangaId: string): void {
    this.repository.remove(mangaId);
  }
}

function target(chapter: Chapter) {
  return { id: chapter.id, number: chapter.chapterNumber };
}

// `chapters` must be pre-sorted ascending by chapterNumber.
function continueTarget(
  chapters: Chapter[],
  chapterId: string | undefined,
  page: number | undefined,
): { nextChapter: EnrichedLibraryEntry["nextChapter"]; caughtUp: boolean } {
  if (chapters.length === 0) return { nextChapter: null, caughtUp: false };

  const current =
    chapterId === undefined
      ? -1
      : chapters.findIndex((c) => c.id === chapterId);

  // Never-read and last-read-chapter-now-gone both start over rather than
  // claiming caught-up.
  if (current === -1)
    return { nextChapter: target(chapters[0]), caughtUp: false };

  const chapter = chapters[current];
  // An unknown pageCount can't confirm finish, so it reads as unfinished (resume).
  const finished =
    chapter.pageCount !== undefined && (page ?? 0) >= chapter.pageCount - 1;
  if (!finished) return { nextChapter: target(chapter), caughtUp: false };

  const next = chapters[current + 1];
  if (next === undefined) return { nextChapter: null, caughtUp: true };
  return { nextChapter: target(next), caughtUp: false };
}

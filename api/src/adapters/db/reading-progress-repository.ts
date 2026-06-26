// SQLite implementation of the ReadingProgressRepository port (RFC §7).
//
// One row per manga (device-agnostic — keyed by manga only, never by device).
// `save` is last-write-wins: an incoming write only replaces the stored row
// when its `updatedAt` is newer than or equal to the stored one.

import type {
  ReadingProgress,
  ReadingProgressRepository,
} from "../../services/ports/reading-progress-repository.js";
import type { AppDatabase } from "./database.js";

interface Row {
  manga_id: string;
  chapter_id: string;
  page: number;
  updated_at: number;
}

export class SqliteReadingProgressRepository
  implements ReadingProgressRepository
{
  constructor(private readonly db: AppDatabase) {}

  get(mangaId: string): ReadingProgress | undefined {
    const row = this.db
      .prepare("SELECT * FROM reading_progress WHERE manga_id = ?")
      .get(mangaId) as Row | undefined;
    if (row === undefined) {
      return undefined;
    }
    return {
      mangaId: row.manga_id,
      chapterId: row.chapter_id,
      page: row.page,
      updatedAt: row.updated_at,
    };
  }

  save(progress: ReadingProgress): void {
    // Last-write-wins: on conflict, only overwrite when the incoming write is
    // newer than or equal to the stored one, so a stale write can't clobber.
    this.db
      .prepare(
        `INSERT INTO reading_progress (manga_id, chapter_id, page, updated_at)
         VALUES (@mangaId, @chapterId, @page, @updatedAt)
         ON CONFLICT(manga_id) DO UPDATE SET
           chapter_id = excluded.chapter_id,
           page       = excluded.page,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at >= reading_progress.updated_at`,
      )
      .run(progress);
  }
}

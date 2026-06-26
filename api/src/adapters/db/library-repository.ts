import type {
  LibraryEntry,
  LibraryRepository,
} from "../../services/ports/library-repository.js";
import type { AppDatabase } from "./database.js";

interface Row {
  manga_id: string;
  added_at: number;
}

export class SqliteLibraryRepository implements LibraryRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): LibraryEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM library ORDER BY added_at ASC")
      .all() as Row[];
    return rows.map((row) => ({
      mangaId: row.manga_id,
      addedAt: row.added_at,
    }));
  }

  add(entry: LibraryEntry): void {
    // Idempotent: an existing row for the manga is kept unchanged.
    this.db
      .prepare(
        `INSERT OR IGNORE INTO library (manga_id, added_at)
         VALUES (@mangaId, @addedAt)`,
      )
      .run(entry);
  }

  remove(mangaId: string): void {
    this.db.prepare("DELETE FROM library WHERE manga_id = ?").run(mangaId);
  }
}

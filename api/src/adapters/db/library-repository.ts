import type {
  LibraryEntry,
  LibraryRepository,
} from "../../services/ports/library-repository.js";
import type { AppDatabase } from "./database.js";

interface Row {
  manga_id: string;
  added_at: number;
  title: string | null;
}

export class SqliteLibraryRepository implements LibraryRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): LibraryEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM library ORDER BY added_at ASC")
      .all() as Row[];
    // Denormalised title captured at follow time (API-908); omitted when absent
    // so a pre-title row degrades gracefully rather than carrying a null title.
    return rows.map((row) =>
      row.title == null
        ? { mangaId: row.manga_id, addedAt: row.added_at }
        : { mangaId: row.manga_id, addedAt: row.added_at, title: row.title },
    );
  }

  add(entry: LibraryEntry): void {
    // Idempotent: an existing row for the manga is kept unchanged. `title` is
    // optional on the port — bind NULL when a title-less client follows.
    this.db
      .prepare(
        `INSERT OR IGNORE INTO library (manga_id, added_at, title)
         VALUES (@mangaId, @addedAt, @title)`,
      )
      .run({
        mangaId: entry.mangaId,
        addedAt: entry.addedAt,
        title: entry.title ?? null,
      });
  }

  remove(mangaId: string): void {
    this.db.prepare("DELETE FROM library WHERE manga_id = ?").run(mangaId);
  }
}

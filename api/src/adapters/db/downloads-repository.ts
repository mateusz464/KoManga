// SQLite implementation of the DownloadsRepository port (RFC §7).
//
// One row per chapter. `create` is idempotent (`INSERT OR IGNORE`): a
// re-download of an existing chapter keeps the original row unchanged.

import type {
  DownloadRecord,
  DownloadStatus,
  DownloadsRepository,
} from "../../services/ports/downloads-repository.js";
import type { AppDatabase } from "./database.js";

interface Row {
  chapter_id: string;
  manga_id: string;
  cbz_path: string;
  status: DownloadStatus;
  created_at: number;
}

function toRecord(row: Row): DownloadRecord {
  return {
    chapterId: row.chapter_id,
    mangaId: row.manga_id,
    cbzPath: row.cbz_path,
    status: row.status,
    createdAt: row.created_at,
  };
}

export class SqliteDownloadsRepository implements DownloadsRepository {
  constructor(private readonly db: AppDatabase) {}

  get(chapterId: string): DownloadRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM downloads WHERE chapter_id = ?")
      .get(chapterId) as Row | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  list(): DownloadRecord[] {
    const rows = this.db.prepare("SELECT * FROM downloads").all() as Row[];
    return rows.map(toRecord);
  }

  create(record: DownloadRecord): void {
    // Idempotent: an existing row for the chapter is kept unchanged.
    this.db
      .prepare(
        `INSERT OR IGNORE INTO downloads
           (chapter_id, manga_id, cbz_path, status, created_at)
         VALUES (@chapterId, @mangaId, @cbzPath, @status, @createdAt)`,
      )
      .run(record);
  }

  updateStatus(chapterId: string, status: DownloadStatus): void {
    this.db
      .prepare("UPDATE downloads SET status = ? WHERE chapter_id = ?")
      .run(status, chapterId);
  }
}

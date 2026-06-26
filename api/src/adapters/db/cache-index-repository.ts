// SQLite implementation of the CacheIndexRepository port (RFC §7).
//
// Bookkeeping ONLY for the ephemeral session cache (keys, sizes, TTLs) — never
// the page bytes, and nothing to do with the persistent CBZ download store.

import type {
  CacheIndexEntry,
  CacheIndexRepository,
} from "../../services/ports/cache-index-repository.js";
import type { AppDatabase } from "./database.js";

interface Row {
  key: string;
  size_bytes: number;
  stored_at: number;
  expires_at: number;
}

function toEntry(row: Row): CacheIndexEntry {
  return {
    key: row.key,
    sizeBytes: row.size_bytes,
    storedAt: row.stored_at,
    expiresAt: row.expires_at,
  };
}

export class SqliteCacheIndexRepository implements CacheIndexRepository {
  constructor(private readonly db: AppDatabase) {}

  get(key: string): CacheIndexEntry | undefined {
    const row = this.db
      .prepare("SELECT * FROM cache_index WHERE key = ?")
      .get(key) as Row | undefined;
    return row === undefined ? undefined : toEntry(row);
  }

  upsert(entry: CacheIndexEntry): void {
    this.db
      .prepare(
        `INSERT INTO cache_index (key, size_bytes, stored_at, expires_at)
         VALUES (@key, @sizeBytes, @storedAt, @expiresAt)
         ON CONFLICT(key) DO UPDATE SET
           size_bytes = excluded.size_bytes,
           stored_at  = excluded.stored_at,
           expires_at = excluded.expires_at`,
      )
      .run(entry);
  }

  delete(key: string): void {
    this.db.prepare("DELETE FROM cache_index WHERE key = ?").run(key);
  }

  list(): CacheIndexEntry[] {
    const rows = this.db.prepare("SELECT * FROM cache_index").all() as Row[];
    return rows.map(toEntry);
  }

  totalBytes(): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM cache_index")
      .get() as { total: number };
    return row.total;
  }
}

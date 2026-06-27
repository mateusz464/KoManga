// SQLite holds only our data (RFC §7); Suwayomi's catalogue is never duplicated.

import Database from "better-sqlite3";

// Only the db adapter sees this concrete type (CLAUDE.md §11).
export type AppDatabase = Database.Database;

// Plain SQL, run on every open; `IF NOT EXISTS` makes re-running safe.
const MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS reading_progress (
    manga_id   TEXT    PRIMARY KEY,
    chapter_id TEXT    NOT NULL,
    page       INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS downloads (
    chapter_id TEXT    PRIMARY KEY,
    manga_id   TEXT    NOT NULL,
    cbz_path   TEXT    NOT NULL,
    status     TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cache_index (
    key        TEXT    PRIMARY KEY,
    size_bytes INTEGER NOT NULL,
    stored_at  INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS library (
    manga_id TEXT    PRIMARY KEY,
    added_at INTEGER NOT NULL
  );
`;

export function openDatabase(file: string): AppDatabase {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(MIGRATIONS);
  return db;
}

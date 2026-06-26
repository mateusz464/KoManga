// SQLite connection + migrations for OUR data (CLAUDE.md §2, §8).
//
// `better-sqlite3` is the chosen driver; its types stay inside the db adapter
// and never leak across a port boundary. Migrations are plain SQL run on
// startup, idempotently (`IF NOT EXISTS`), so opening an existing DB is safe
// and preserves its data.
//
// We own ONLY our data (RFC §7): reading_progress, downloads, cache_index.
// Suwayomi's catalogue/source/chapter metadata is never duplicated here.

import Database from "better-sqlite3";

/** The opened database handle. Only the db adapter sees this concrete type. */
export type AppDatabase = Database.Database;

// Plain SQL schema, run on every open. `IF NOT EXISTS` makes re-running safe.
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
`;

/**
 * Opens the SQLite database at `file`, running migrations to create the schema
 * on a fresh DB (and safely re-running on an already-migrated one), then
 * returns the connection.
 */
export function openDatabase(file: string): AppDatabase {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(MIGRATIONS);
  return db;
}

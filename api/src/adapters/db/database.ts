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
    added_at INTEGER NOT NULL,
    title    TEXT
  );
`;

// Idempotent ALTER for a column added after the table first shipped (API-908):
// fresh DBs get `title` from the CREATE above; DBs created before it get it here,
// backfilled NULL. Guarded so re-running on startup never throws a duplicate.
function addColumnIfMissing(
  db: AppDatabase,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((row) => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function openDatabase(file: string): AppDatabase {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(MIGRATIONS);
  addColumnIfMissing(db, "library", "title", "TEXT");
  return db;
}

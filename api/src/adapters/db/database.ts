// SQLite connection + migrations for OUR data (CLAUDE.md §2, §8).
//
// `better-sqlite3` is the chosen driver; its types stay inside the db adapter
// and never leak across a port boundary. Migrations are plain SQL run on
// startup, idempotently, so opening an existing DB is safe.
//
// Stub for API-501 (the [TEST] ticket): the real connection + migrations land
// in API-502, so this throws to keep the contract tests red until then.

import type Database from "better-sqlite3";

/** The opened database handle. Only the db adapter sees this concrete type. */
export type AppDatabase = Database.Database;

/**
 * Opens the SQLite database at `file`, running migrations to create the schema
 * on a fresh DB (and safely re-running on an already-migrated one), then
 * returns the connection.
 */
export function openDatabase(_file: string): AppDatabase {
  throw new Error("openDatabase not implemented (API-502)");
}

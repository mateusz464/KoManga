import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDatabase,
  type AppDatabase,
} from "../../../src/adapters/db/database.js";
import { SqliteReadingProgressRepository } from "../../../src/adapters/db/reading-progress-repository.js";
import { SqliteDownloadsRepository } from "../../../src/adapters/db/downloads-repository.js";
import { SqliteCacheIndexRepository } from "../../../src/adapters/db/cache-index-repository.js";
import { SqliteLibraryRepository } from "../../../src/adapters/db/library-repository.js";
import type {
  ReadingProgress,
  ReadingProgressRepository,
} from "../../../src/services/ports/reading-progress-repository.js";
import type {
  DownloadRecord,
  DownloadsRepository,
} from "../../../src/services/ports/downloads-repository.js";
import type {
  CacheIndexEntry,
  CacheIndexRepository,
} from "../../../src/services/ports/cache-index-repository.js";
import type {
  LibraryEntry,
  LibraryRepository,
} from "../../../src/services/ports/library-repository.js";

// Contract test for the SQLite data layer (API-501): migrations + repository
// CRUD behind the port interfaces (RFC §7, CLAUDE.md §8). Per CLAUDE.md §4.4
// the adapter is exercised against the REAL `better-sqlite3` library on a temp
// on-disk DB (not a mock). The real connection + CRUD lands in API-502; these
// assertions stay red until then (the stub throws).
//
// Contract:
//   - migrations create the downloads/reading_progress/cache_index schema on a
//     fresh DB, and re-running them (open again) is safe (run-on-startup)
//   - reading_progress: get/save, device-agnostic, last-write-wins by updatedAt
//   - downloads: get/list/create (idempotent per chapter)/updateStatus
//   - cache_index: get/upsert/delete/list/totalBytes bookkeeping
//   - every repository sits behind a mockable interface

let tmpDir: string;
const opened: AppDatabase[] = [];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "komanga-db-"));
});

afterEach(() => {
  for (const db of opened) {
    try {
      db.close();
    } catch {
      // best-effort cleanup
    }
  }
  opened.length = 0;
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Opens a fresh migrated DB on disk; closed + removed after each test. */
function freshDb(file = "test.sqlite"): AppDatabase {
  const db = openDatabase(join(tmpDir, file));
  opened.push(db);
  return db;
}

function repos(db: AppDatabase = freshDb()) {
  return {
    db,
    progress: new SqliteReadingProgressRepository(db),
    downloads: new SqliteDownloadsRepository(db),
    cacheIndex: new SqliteCacheIndexRepository(db),
    library: new SqliteLibraryRepository(db),
  };
}

function columnNames(db: AppDatabase, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function tableNames(db: AppDatabase): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

const PROGRESS: ReadingProgress = {
  mangaId: "manga-1",
  chapterId: "chapter-1",
  page: 3,
  updatedAt: 1_000,
};

const DOWNLOAD: DownloadRecord = {
  chapterId: "chapter-1",
  mangaId: "manga-1",
  cbzPath: "/downloads/manga-1/chapter-1.cbz",
  status: "pending",
  createdAt: 1_000,
};

const CACHE_ENTRY: CacheIndexEntry = {
  key: "1:0 eink",
  sizeBytes: 2_048,
  storedAt: 1_000,
  expiresAt: 61_000,
};

const LIBRARY_ENTRY: LibraryEntry = {
  mangaId: "40",
  title: "One Piece",
  addedAt: 1_000,
};

describe("SQLite data layer (API-501)", () => {
  describe("migrations", () => {
    it("creates the downloads, reading_progress and cache_index tables on a fresh DB", () => {
      const db = freshDb();

      const tables = tableNames(db);
      expect(tables).toContain("reading_progress");
      expect(tables).toContain("downloads");
      expect(tables).toContain("cache_index");
      expect(tables).toContain("library");
    });

    it("is safe to run again on an already-migrated DB and preserves data", () => {
      const file = "persist.sqlite";
      const first = repos(freshDb(file));
      first.downloads.create(DOWNLOAD);
      first.db.close();
      opened.length = 0;

      // Re-open the same file: migrations run again on startup without error,
      // and the previously written row is still there.
      const second = repos(freshDb(file));
      expect(() => tableNames(second.db)).not.toThrow();
      expect(second.downloads.get(DOWNLOAD.chapterId)).toEqual(DOWNLOAD);
    });
  });

  describe("ReadingProgressRepository", () => {
    it("returns undefined for a manga with no progress", () => {
      const { progress } = repos();

      expect(progress.get("unknown")).toBeUndefined();
    });

    it("stores then returns a manga's position", () => {
      const { progress } = repos();

      progress.save(PROGRESS);

      expect(progress.get(PROGRESS.mangaId)).toEqual(PROGRESS);
    });

    it("keeps progress keyed by manga only (device-agnostic, one row per manga)", () => {
      const { progress } = repos();

      // A later write for the same manga replaces the position rather than
      // adding a second row — there is no device dimension to distinguish them.
      progress.save(PROGRESS);
      progress.save({
        ...PROGRESS,
        chapterId: "chapter-2",
        page: 0,
        updatedAt: 2_000,
      });

      const got = progress.get(PROGRESS.mangaId);
      expect(got).toEqual({
        mangaId: PROGRESS.mangaId,
        chapterId: "chapter-2",
        page: 0,
        updatedAt: 2_000,
      });
    });

    it("last-write-wins: a newer updatedAt overwrites an older one", () => {
      const { progress } = repos();

      progress.save(PROGRESS); // updatedAt 1000
      progress.save({ ...PROGRESS, page: 9, updatedAt: 5_000 });

      expect(progress.get(PROGRESS.mangaId)?.page).toBe(9);
    });

    it("last-write-wins: an older updatedAt does not clobber a newer one", () => {
      const { progress } = repos();

      progress.save({ ...PROGRESS, page: 9, updatedAt: 5_000 });
      progress.save({ ...PROGRESS, page: 1, updatedAt: 2_000 }); // stale write

      expect(progress.get(PROGRESS.mangaId)?.page).toBe(9);
    });
  });

  describe("DownloadsRepository", () => {
    it("returns undefined for a chapter that was never downloaded", () => {
      const { downloads } = repos();

      expect(downloads.get("unknown")).toBeUndefined();
    });

    it("lists nothing when no downloads exist", () => {
      const { downloads } = repos();

      expect(downloads.list()).toEqual([]);
    });

    it("creates then returns a download record", () => {
      const { downloads } = repos();

      downloads.create(DOWNLOAD);

      expect(downloads.get(DOWNLOAD.chapterId)).toEqual(DOWNLOAD);
    });

    it("lists all created download records", () => {
      const { downloads } = repos();
      const second: DownloadRecord = {
        ...DOWNLOAD,
        chapterId: "chapter-2",
        cbzPath: "/downloads/manga-1/chapter-2.cbz",
      };

      downloads.create(DOWNLOAD);
      downloads.create(second);

      const listed = downloads.list();
      expect(listed).toHaveLength(2);
      expect(listed).toEqual(expect.arrayContaining([DOWNLOAD, second]));
    });

    it("create is idempotent per chapter — no duplicate, original kept", () => {
      const { downloads } = repos();

      downloads.create(DOWNLOAD);
      downloads.create({
        ...DOWNLOAD,
        cbzPath: "/somewhere/else.cbz",
        createdAt: 9_999,
      });

      expect(downloads.list()).toHaveLength(1);
      expect(downloads.get(DOWNLOAD.chapterId)).toEqual(DOWNLOAD);
    });

    it("updates the status of an existing download", () => {
      const { downloads } = repos();

      downloads.create(DOWNLOAD); // pending
      downloads.updateStatus(DOWNLOAD.chapterId, "completed");

      expect(downloads.get(DOWNLOAD.chapterId)?.status).toBe("completed");
    });
  });

  describe("CacheIndexRepository", () => {
    it("returns undefined for a key that was never stored", () => {
      const { cacheIndex } = repos();

      expect(cacheIndex.get("missing")).toBeUndefined();
    });

    it("lists nothing and totals zero when empty", () => {
      const { cacheIndex } = repos();

      expect(cacheIndex.list()).toEqual([]);
      expect(cacheIndex.totalBytes()).toBe(0);
    });

    it("upserts then returns a bookkeeping row", () => {
      const { cacheIndex } = repos();

      cacheIndex.upsert(CACHE_ENTRY);

      expect(cacheIndex.get(CACHE_ENTRY.key)).toEqual(CACHE_ENTRY);
    });

    it("upsert replaces the existing row for a key", () => {
      const { cacheIndex } = repos();

      cacheIndex.upsert(CACHE_ENTRY);
      cacheIndex.upsert({
        ...CACHE_ENTRY,
        sizeBytes: 4_096,
        expiresAt: 99_000,
      });

      expect(cacheIndex.list()).toHaveLength(1);
      expect(cacheIndex.get(CACHE_ENTRY.key)?.sizeBytes).toBe(4_096);
    });

    it("deletes a row by key (and is a no-op for an absent key)", () => {
      const { cacheIndex } = repos();

      cacheIndex.upsert(CACHE_ENTRY);
      cacheIndex.delete(CACHE_ENTRY.key);
      expect(cacheIndex.get(CACHE_ENTRY.key)).toBeUndefined();

      expect(() => cacheIndex.delete("never-existed")).not.toThrow();
    });

    it("totalBytes sums sizeBytes across all rows", () => {
      const { cacheIndex } = repos();

      cacheIndex.upsert(CACHE_ENTRY); // 2048
      cacheIndex.upsert({ ...CACHE_ENTRY, key: "1:1 eink", sizeBytes: 1_000 });

      expect(cacheIndex.totalBytes()).toBe(3_048);
    });
  });

  // API-907: the library row denormalises the manga's display title captured at
  // follow time so `list()` returns it with no per-entry Suwayomi fan-out
  // (CLAUDE.md §8). These stay red until API-908 adds the `library.title` column
  // + threads it through the adapter.
  describe("LibraryRepository — display title (API-907)", () => {
    it("has a title column on the library table", () => {
      const { db } = repos();

      expect(columnNames(db, "library")).toContain("title");
    });

    it("persists a title captured at follow time and returns it from list", () => {
      const { library } = repos();

      library.add(LIBRARY_ENTRY);

      expect(library.list()).toEqual([LIBRARY_ENTRY]);
    });

    it("returns entries ordered by added_at ASC, each carrying its title", () => {
      const { library } = repos();
      const earlier: LibraryEntry = {
        mangaId: "41",
        title: "Naruto",
        addedAt: 500,
      };

      library.add(LIBRARY_ENTRY); // addedAt 1000
      library.add(earlier); // addedAt 500

      expect(library.list()).toEqual([earlier, LIBRARY_ENTRY]);
    });

    it("degrades gracefully for a title-less row (nullable): lists without throwing", () => {
      const { library } = repos();

      // A follow that carries no title (pre-title / offline client) still stores.
      library.add({ mangaId: "99", addedAt: 500 });

      expect(() => library.list()).not.toThrow();
      const entry = library.list().find((e) => e.mangaId === "99");
      expect(entry?.addedAt).toBe(500);
      // No title captured → nullish, never a thrown error or a bogus value.
      expect(entry?.title ?? null).toBeNull();
    });
  });

  describe("mockability (DB access behind interfaces)", () => {
    it("ReadingProgressRepository can be satisfied by a mock", () => {
      const mock: ReadingProgressRepository = {
        get: vi.fn().mockReturnValue(PROGRESS),
        save: vi.fn(),
      };

      mock.save(PROGRESS);
      expect(mock.get(PROGRESS.mangaId)).toBe(PROGRESS);
      expect(mock.save).toHaveBeenCalledWith(PROGRESS);
    });

    it("DownloadsRepository can be satisfied by a mock", () => {
      const mock: DownloadsRepository = {
        get: vi.fn().mockReturnValue(DOWNLOAD),
        list: vi.fn().mockReturnValue([DOWNLOAD]),
        create: vi.fn(),
        updateStatus: vi.fn(),
      };

      expect(mock.list()).toEqual([DOWNLOAD]);
      expect(mock.get(DOWNLOAD.chapterId)).toBe(DOWNLOAD);
    });

    it("CacheIndexRepository can be satisfied by a mock", () => {
      const mock: CacheIndexRepository = {
        get: vi.fn().mockReturnValue(CACHE_ENTRY),
        upsert: vi.fn(),
        delete: vi.fn(),
        list: vi.fn().mockReturnValue([CACHE_ENTRY]),
        totalBytes: vi.fn().mockReturnValue(CACHE_ENTRY.sizeBytes),
      };

      expect(mock.totalBytes()).toBe(CACHE_ENTRY.sizeBytes);
      expect(mock.get(CACHE_ENTRY.key)).toBe(CACHE_ENTRY);
    });

    it("LibraryRepository can be satisfied by a mock", () => {
      const mock: LibraryRepository = {
        list: vi.fn().mockReturnValue([LIBRARY_ENTRY]),
        add: vi.fn(),
        remove: vi.fn(),
      };

      expect(mock.list()).toEqual([LIBRARY_ENTRY]);
      mock.add(LIBRARY_ENTRY);
      expect(mock.add).toHaveBeenCalledWith(LIBRARY_ENTRY);
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import type {
  LibraryEntry,
  LibraryRepository,
} from "../../src/services/ports/library-repository.js";
import type {
  ReadingProgress,
  ReadingProgressRepository,
} from "../../src/services/ports/reading-progress-repository.js";
import type {
  Chapter,
  SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

// Each GET /api/library entry gains a computed continue target — nextChapter and
// caughtUp — from progress (SQLite) and Suwayomi's STORED chapter list, never a
// live scrape. Resolved against chapters sorted by chapterNumber ASC:
//   never-read              → first chapter
//   part-way (not finished) → that same chapter (resume)
//   finished, later exists  → the following chapter
//   finished the newest     → no target, caughtUp: true
// "Finished" ≙ 0-based page >= pageCount - 1; an unknown pageCount can't confirm
// finish, so it resumes.
function makeLibraryRepo(seed: LibraryEntry[] = []) {
  const rows = new Map<string, LibraryEntry>();
  for (const e of seed) rows.set(e.mangaId, e);

  const list = vi.fn(() => [...rows.values()]);
  const add = vi.fn((entry: LibraryEntry) => {
    if (!rows.has(entry.mangaId)) rows.set(entry.mangaId, entry);
  });
  const remove = vi.fn((mangaId: string) => {
    rows.delete(mangaId);
  });

  const repo: LibraryRepository = { list, add, remove };
  return { repo, list };
}

function makeProgressRepo(seed: ReadingProgress[] = []) {
  const rows = new Map<string, ReadingProgress>();
  for (const p of seed) rows.set(p.mangaId, p);

  const get = vi.fn((mangaId: string) => rows.get(mangaId));
  const save = vi.fn();
  const repo: ReadingProgressRepository = { get, save };
  return { repo, get };
}

// listChapters returns seeded stored chapters; fetchChapters/getMangaDetails
// throw, structurally pinning "no live scrape, no per-entry getManga".
function makeSuwayomi(chaptersByManga: Record<string, Chapter[]>) {
  const listChapters = vi.fn(async (mangaId: string): Promise<Chapter[]> => {
    const chapters = chaptersByManga[mangaId];
    if (chapters === undefined) {
      throw new Error(`unexpected listChapters for ${mangaId}`);
    }
    return chapters;
  });
  const fetchChapters = vi.fn(async (): Promise<Chapter[]> => {
    throw new Error("fetchChapters (live scrape) must not be called");
  });
  const getMangaDetails = vi.fn(async (): Promise<never> => {
    throw new Error("getMangaDetails (per-entry getManga) must not be called");
  });

  const suwayomi: SuwayomiClient = {
    ...stubSuwayomi(),
    listChapters,
    fetchChapters,
    getMangaDetails,
  };
  return { suwayomi, listChapters, fetchChapters, getMangaDetails };
}

interface Scenario {
  library?: LibraryEntry[];
  progress?: ReadingProgress[];
  chapters?: Record<string, Chapter[]>;
}

function buildDeps(scenario: Scenario = {}) {
  const { repo: libraryRepository } = makeLibraryRepo(scenario.library ?? []);
  const { repo: readingProgressRepository } = makeProgressRepo(
    scenario.progress ?? [],
  );
  const { suwayomi, listChapters, fetchChapters, getMangaDetails } =
    makeSuwayomi(scenario.chapters ?? {});

  return {
    app: createApp({ suwayomi, libraryRepository, readingProgressRepository }),
    listChapters,
    fetchChapters,
    getMangaDetails,
  };
}

function chapter(
  id: string,
  chapterNumber: number,
  pageCount?: number,
): Chapter {
  return pageCount === undefined
    ? { id, name: `Chapter ${chapterNumber}`, chapterNumber }
    : { id, name: `Chapter ${chapterNumber}`, chapterNumber, pageCount };
}

const MANGA = "1";
const TITLE = "One Piece";
// Deliberately out of order so the ASC-by-chapterNumber sort is exercised.
const CHAPTERS: Chapter[] = [
  chapter("c3", 3, 10),
  chapter("c1", 1, 10),
  chapter("c2", 2, 10),
];

function libEntry(): LibraryEntry {
  return { mangaId: MANGA, addedAt: 1000, title: TITLE };
}

async function getData(app: ReturnType<typeof createApp>) {
  const res = await request(app).get("/api/library");
  expect(res.status).toBe(200);
  return res.body.data as Array<Record<string, unknown>>;
}

describe("GET /api/library — continue target (API-911)", () => {
  it("never-read manga → next is the first chapter (sorted ASC), not caught up", async () => {
    const d = buildDeps({
      library: [libEntry()],
      progress: [],
      chapters: { [MANGA]: CHAPTERS },
    });

    const data = await getData(d.app);

    expect(data).toEqual([
      {
        mangaId: MANGA,
        addedAt: 1000,
        title: TITLE,
        nextChapter: { id: "c1", number: 1 },
        caughtUp: false,
      },
    ]);
  });

  it("part-way through the last-read chapter → resume that same chapter", async () => {
    const d = buildDeps({
      library: [libEntry()],
      // page 3 of a 10-page chapter: 3 < 10 - 1, so not finished.
      progress: [{ mangaId: MANGA, chapterId: "c2", page: 3, updatedAt: 1 }],
      chapters: { [MANGA]: CHAPTERS },
    });

    const [entry] = await getData(d.app);

    expect(entry.nextChapter).toEqual({ id: "c2", number: 2 });
    expect(entry.caughtUp).toBe(false);
  });

  it("finished a chapter that is not the last → next is the following chapter", async () => {
    const d = buildDeps({
      library: [libEntry()],
      // page 9 of a 10-page chapter: 9 >= 10 - 1, so finished.
      progress: [{ mangaId: MANGA, chapterId: "c2", page: 9, updatedAt: 1 }],
      chapters: { [MANGA]: CHAPTERS },
    });

    const [entry] = await getData(d.app);

    expect(entry.nextChapter).toEqual({ id: "c3", number: 3 });
    expect(entry.caughtUp).toBe(false);
  });

  it("finished the newest chapter → caught up, no next target", async () => {
    const d = buildDeps({
      library: [libEntry()],
      progress: [{ mangaId: MANGA, chapterId: "c3", page: 9, updatedAt: 1 }],
      chapters: { [MANGA]: CHAPTERS },
    });

    const [entry] = await getData(d.app);

    expect(entry.nextChapter).toBeNull();
    expect(entry.caughtUp).toBe(true);
  });

  it("pageCount unknown → finish can't be confirmed, treated as part-way (resume)", async () => {
    const noCounts: Chapter[] = [
      chapter("c1", 1),
      chapter("c2", 2),
      chapter("c3", 3),
    ];
    const d = buildDeps({
      library: [libEntry()],
      // A large page index still resumes the same chapter — finish is unknowable.
      progress: [{ mangaId: MANGA, chapterId: "c2", page: 99, updatedAt: 1 }],
      chapters: { [MANGA]: noCounts },
    });

    const [entry] = await getData(d.app);

    expect(entry.nextChapter).toEqual({ id: "c2", number: 2 });
    expect(entry.caughtUp).toBe(false);
  });

  it("preserves the decimal chapterNumber exactly (no rounding)", async () => {
    // Grand Blue Dreaming style: a 40.5 chapter sits between 40 and 41.
    const decimals: Chapter[] = [
      chapter("a", 41, 10),
      chapter("b", 40.5, 10),
      chapter("c", 40, 10),
    ];
    const d = buildDeps({
      library: [libEntry()],
      // Finished chapter 40 → next is 40.5, the following chapter.
      progress: [{ mangaId: MANGA, chapterId: "c", page: 9, updatedAt: 1 }],
      chapters: { [MANGA]: decimals },
    });

    const [entry] = await getData(d.app);

    expect(entry.nextChapter).toEqual({ id: "b", number: 40.5 });
  });

  it("a followed manga with no stored chapters → null next, not caught up", async () => {
    const d = buildDeps({
      library: [libEntry()],
      progress: [],
      chapters: { [MANGA]: [] },
    });

    const [entry] = await getData(d.app);

    // Client falls back to a bare "Continue"; it is not caught up (nothing to be
    // caught up on).
    expect(entry.nextChapter).toBeNull();
    expect(entry.caughtUp).toBe(false);
  });

  it("progress on a chapter absent from the current list → degrades without throwing", async () => {
    const d = buildDeps({
      library: [libEntry()],
      // Last-read chapter was removed from the source's stored list.
      progress: [{ mangaId: MANGA, chapterId: "gone", page: 5, updatedAt: 1 }],
      chapters: { [MANGA]: CHAPTERS },
    });

    const [entry] = await getData(d.app);

    // No throw (200), and it degrades to the first chapter — as if unread — rather
    // than claiming caught-up.
    expect(entry.nextChapter).toEqual({ id: "c1", number: 1 });
    expect(entry.caughtUp).toBe(false);
  });

  it("computes from stored chapters only — no live scrape, no per-entry getManga", async () => {
    const d = buildDeps({
      library: [libEntry()],
      progress: [],
      chapters: { [MANGA]: CHAPTERS },
    });

    await getData(d.app);

    expect(d.listChapters).toHaveBeenCalledWith(MANGA);
    expect(d.fetchChapters).not.toHaveBeenCalled();
    expect(d.getMangaDetails).not.toHaveBeenCalled();
  });

  it("enriches every entry, preserving added_at ASC order", async () => {
    const d = buildDeps({
      library: [
        { mangaId: "1", addedAt: 1000, title: "One Piece" },
        { mangaId: "2", addedAt: 2000, title: "Naruto" },
      ],
      progress: [
        // Manga 1: finished ch 1 → next is ch 2.
        { mangaId: "1", chapterId: "op1", page: 9, updatedAt: 1 },
        // Manga 2: caught up.
        { mangaId: "2", chapterId: "nar2", page: 9, updatedAt: 1 },
      ],
      chapters: {
        "1": [chapter("op1", 1, 10), chapter("op2", 2, 10)],
        "2": [chapter("nar1", 1, 10), chapter("nar2", 2, 10)],
      },
    });

    const data = await getData(d.app);

    expect(data).toEqual([
      {
        mangaId: "1",
        addedAt: 1000,
        title: "One Piece",
        nextChapter: { id: "op2", number: 2 },
        caughtUp: false,
      },
      {
        mangaId: "2",
        addedAt: 2000,
        title: "Naruto",
        nextChapter: null,
        caughtUp: true,
      },
    ]);
  });

  it("still returns the empty library as { data: [] }", async () => {
    const d = buildDeps({ library: [], chapters: {} });

    const res = await request(d.app).get("/api/library");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });
});

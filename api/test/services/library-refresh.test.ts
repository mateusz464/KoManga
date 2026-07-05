import { describe, expect, it, vi } from "vitest";
import { refreshFollowedChapters } from "../../src/services/library-refresh.js";
import type {
  LibraryEntry,
  LibraryRepository,
} from "../../src/services/ports/library-repository.js";
import type {
  Chapter,
  SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

// Contract test for the periodic followed-manga refresh (API-913, KRP-607).
//
// API-911/912 compute a library entry's continue/caught-up state from Suwayomi's
// STORED chapter list (`listChapters`), which only refreshes when a manga is
// opened. So a caught-up manga never surfaces a newly-released chapter until the
// user reopens it. This pass fixes that: for EACH followed manga only — the
// `library` rows, never all Suwayomi manga — it triggers the source scrape
// (`fetchChapters`) so the stored list stays current on its own.
//
// This is the one place a chapter-scrape fan-out is acceptable: a bounded
// background job, not the per-request client fan-out rejected in API-911 (RFC
// §13, CLAUDE.md §8). So the pass is pinned here as a pure, injectable unit —
// it takes the library repo + Suwayomi client and is independent of any timer
// (the scheduler in API-914 only calls it), all ports mocked at the boundary
// (CLAUDE.md §4). The runnable is implemented in API-914 — these assertions stay
// red (the current stub fetches nothing) until then.

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

// A SuwayomiClient whose `fetchChapters` (the source scrape) is a controllable
// spy. `listChapters` throws loudly: the refresh must trigger the scrape that
// updates the stored list, not merely re-read it — a stray `listChapters` blows
// up the test rather than passing silently.
function makeSuwayomi(fetchChapters: SuwayomiClient["fetchChapters"]) {
  const listChapters = vi.fn(async (): Promise<never> => {
    throw new Error(
      "listChapters (stored read) must not be called — refresh scrapes",
    );
  });
  const suwayomi: SuwayomiClient = {
    ...stubSuwayomi(),
    fetchChapters,
    listChapters,
  };
  return { suwayomi, listChapters };
}

function entry(mangaId: string): LibraryEntry {
  return { mangaId, addedAt: Number(mangaId) };
}

const NO_CHAPTERS: Chapter[] = [];

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("refreshFollowedChapters (API-913)", () => {
  it("scrapes fresh chapters for each followed manga — and only followed manga", async () => {
    const { repo } = makeLibraryRepo([entry("1"), entry("2"), entry("3")]);
    const fetchChapters = vi.fn(async (_mangaId: string) => NO_CHAPTERS);
    const { suwayomi } = makeSuwayomi(fetchChapters);

    await refreshFollowedChapters(repo, suwayomi);

    const fetched = fetchChapters.mock.calls.map(([id]) => id).sort();
    expect(fetched).toEqual(["1", "2", "3"]);
    // Nothing outside the library is ever scraped.
    expect(fetchChapters).not.toHaveBeenCalledWith("999");
    expect(fetchChapters).toHaveBeenCalledTimes(3);
  });

  it("reads the followed set from the library repository", async () => {
    const { repo, list } = makeLibraryRepo([entry("1")]);
    const fetchChapters = vi.fn(async (_mangaId: string) => NO_CHAPTERS);
    const { suwayomi } = makeSuwayomi(fetchChapters);

    await refreshFollowedChapters(repo, suwayomi);

    expect(list).toHaveBeenCalled();
  });

  it("does nothing (and never scrapes) when the library is empty", async () => {
    const { repo } = makeLibraryRepo([]);
    const fetchChapters = vi.fn(async (_mangaId: string) => NO_CHAPTERS);
    const { suwayomi } = makeSuwayomi(fetchChapters);

    await expect(
      refreshFollowedChapters(repo, suwayomi),
    ).resolves.toBeUndefined();
    expect(fetchChapters).not.toHaveBeenCalled();
  });

  it("isolates a single manga's failure — the rest still refresh", async () => {
    const { repo } = makeLibraryRepo([entry("1"), entry("2"), entry("3")]);
    // Manga 2's source scrape fails; 1 and 3 must still be refreshed.
    const fetchChapters = vi.fn(async (mangaId: string) => {
      if (mangaId === "2") throw new Error("source scrape failed");
      return NO_CHAPTERS;
    });
    const { suwayomi } = makeSuwayomi(fetchChapters);

    // The pass as a whole resolves — one bad entry never aborts it or rejects.
    await expect(
      refreshFollowedChapters(repo, suwayomi),
    ).resolves.toBeUndefined();

    expect(fetchChapters).toHaveBeenCalledWith("1");
    expect(fetchChapters).toHaveBeenCalledWith("2");
    expect(fetchChapters).toHaveBeenCalledWith("3");
  });

  it("processes entries with bounded concurrency — not an all-at-once fan-out", async () => {
    const { repo } = makeLibraryRepo([
      entry("1"),
      entry("2"),
      entry("3"),
      entry("4"),
    ]);

    let inFlight = 0;
    let peak = 0;
    const gate = deferred<Chapter[]>();
    const fetchChapters = vi.fn(async (_mangaId: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const chapters = await gate.promise;
      inFlight -= 1;
      return chapters;
    });
    const { suwayomi } = makeSuwayomi(fetchChapters);

    const pass = refreshFollowedChapters(repo, suwayomi, { concurrency: 2 });

    // With 4 followed manga and a cap of 2, only 2 scrapes are in flight while the
    // rest wait — a cap of 2 must not launch all 4 at once.
    await vi.waitFor(() => expect(fetchChapters).toHaveBeenCalledTimes(2));
    await tick();
    expect(fetchChapters).toHaveBeenCalledTimes(2);
    expect(peak).toBe(2);

    // Draining the first wave lets the remaining entries through; the cap holds.
    gate.resolve(NO_CHAPTERS);
    await pass;
    expect(fetchChapters).toHaveBeenCalledTimes(4);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

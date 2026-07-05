import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleFollowedChapterRefresh } from "../../src/services/library-refresh-scheduler.js";
import type {
  LibraryEntry,
  LibraryRepository,
} from "../../src/services/ports/library-repository.js";
import type {
  Chapter,
  SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

function makeLibraryRepo(seed: LibraryEntry[]): LibraryRepository {
  const rows = new Map(seed.map((e) => [e.mangaId, e]));
  return {
    list: () => [...rows.values()],
    add: () => undefined,
    remove: () => undefined,
  };
}

function makeSuwayomi(
  fetchChapters: SuwayomiClient["fetchChapters"],
): SuwayomiClient {
  return { ...stubSuwayomi(), fetchChapters };
}

const entry = (mangaId: string): LibraryEntry => ({
  mangaId,
  addedAt: Number(mangaId),
});
const NO_CHAPTERS: Chapter[] = [];

describe("scheduleFollowedChapterRefresh (API-914)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs a pass immediately when runOnStart is set", async () => {
    const repo = makeLibraryRepo([entry("1")]);
    const fetchChapters = vi.fn(async () => NO_CHAPTERS);
    const scheduled = scheduleFollowedChapterRefresh(
      repo,
      makeSuwayomi(fetchChapters),
      { intervalMs: 60_000, runOnStart: true },
    );

    await vi.waitFor(() => expect(fetchChapters).toHaveBeenCalledWith("1"));
    scheduled.stop();
  });

  it("does not run on start when runOnStart is unset", () => {
    const repo = makeLibraryRepo([entry("1")]);
    const fetchChapters = vi.fn(async () => NO_CHAPTERS);
    const scheduled = scheduleFollowedChapterRefresh(
      repo,
      makeSuwayomi(fetchChapters),
      { intervalMs: 60_000 },
    );

    expect(fetchChapters).not.toHaveBeenCalled();
    scheduled.stop();
  });

  it("runs a pass on each interval tick", async () => {
    const repo = makeLibraryRepo([entry("1")]);
    const fetchChapters = vi.fn(async () => NO_CHAPTERS);
    const scheduled = scheduleFollowedChapterRefresh(
      repo,
      makeSuwayomi(fetchChapters),
      { intervalMs: 60_000 },
    );

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchChapters).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchChapters).toHaveBeenCalledTimes(2);
    scheduled.stop();
  });

  it("stops scheduling further passes once stopped", async () => {
    const repo = makeLibraryRepo([entry("1")]);
    const fetchChapters = vi.fn(async () => NO_CHAPTERS);
    const scheduled = scheduleFollowedChapterRefresh(
      repo,
      makeSuwayomi(fetchChapters),
      { intervalMs: 60_000 },
    );

    scheduled.stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(fetchChapters).not.toHaveBeenCalled();
  });

  it("logs and never rejects when a pass throws", async () => {
    const repo: LibraryRepository = {
      list: () => {
        throw new Error("db unavailable");
      },
      add: () => undefined,
      remove: () => undefined,
    };
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const scheduled = scheduleFollowedChapterRefresh(
      repo,
      makeSuwayomi(vi.fn(async () => NO_CHAPTERS)),
      { intervalMs: 60_000, runOnStart: true, logger },
    );

    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    scheduled.stop();
  });
});

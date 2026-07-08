import { describe, expect, it, vi } from "vitest";
import { ReaderService } from "../../src/services/reader-service.js";
import { DownloadService } from "../../src/services/download-service.js";
import {
  type RawPage,
  type SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";
import type {
  ImageProcessor,
  ImageProfile,
  ProcessedImage,
  SourceImage,
} from "../../src/services/ports/image-processor.js";
import type {
  CbzBuilder,
  CbzPage,
} from "../../src/services/ports/cbz-builder.js";
import type { DownloadStore } from "../../src/services/ports/download-store.js";
import type {
  DownloadRecord,
  DownloadsRepository,
} from "../../src/services/ports/downloads-repository.js";
import type {
  CachedPage,
  SessionCache,
} from "../../src/services/ports/session-cache.js";

// API-916: the CBZ build must fetch + process pages with *bounded concurrency*,
// not one page at a time (which sums every page's origin latency and blows the
// client's 60s socket timeout on a cold read). These tests drive the two build
// paths (ReaderService.readCbz, DownloadService.download) directly through their
// ports, gating each page fetch so we can observe how many run at once and prove
// page order survives out-of-order completion.

const CHAPTER_ID = "77";
const MANGA_ID = "42";
const PAGE_COUNT = 6;
const CONCURRENCY = 3;
const CBZ_BYTES = Buffer.from("PK-fake-cbz-archive-bytes");

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// Lets pending microtasks/timers drain so gate resolutions propagate through the
// worker pool (fetch → process → pick next page) before we assert.
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// A Suwayomi fake whose per-page byte fetch blocks on a caller-controlled gate,
// so a test decides both how many fetches sit in flight and in what order they
// complete. Records the peak concurrency reached.
function makeGatedSuwayomi(pageCount: number) {
  const indexOf = (url: string) => Number(url.replace("url-", ""));
  const gates = Array.from({ length: pageCount }, () => deferred<void>());
  const started = new Set<number>();
  let inFlight = 0;
  let maxInFlight = 0;

  const fetchPageUrls = vi.fn(async (_chapterId: string): Promise<string[]> => {
    return Array.from({ length: pageCount }, (_v, i) => `url-${i}`);
  });
  const fetchPageBytes = vi.fn(async (url: string): Promise<RawPage> => {
    const index = indexOf(url);
    started.add(index);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await gates[index].promise;
    inFlight -= 1;
    return { bytes: Buffer.from(`raw-${index}`), contentType: "image/jpeg" };
  });
  const unexpected = vi.fn(async () => {
    throw new Error("unexpected Suwayomi call");
  });

  const suwayomi: SuwayomiClient = {
    listSources: unexpected,
    search: unexpected,
    getMangaDetails: unexpected,
    listChapters: unexpected,
    getChapterDetails: unexpected,
    fetchChapters: unexpected,
    getChapterPageCount: unexpected,
    fetchPageUrls,
    fetchPageBytes,
    fetchPage: unexpected,
    fetchCover: unexpected,
  };

  return {
    suwayomi,
    fetchPageUrls,
    fetchPageBytes,
    inFlight: () => inFlight,
    maxInFlight: () => maxInFlight,
    started: () => new Set(started),
    resolve: (index: number) => gates[index].resolve(),
  };
}

function makeImageProcessor() {
  const process = vi.fn(
    async (
      source: SourceImage,
      _profile: ImageProfile,
    ): Promise<ProcessedImage> => {
      return {
        bytes: Buffer.concat([Buffer.from("proc-"), source.bytes]),
        contentType: "image/png",
      };
    },
  );
  const imageProcessor: ImageProcessor = { process };
  return { imageProcessor, process };
}

function makeCbzBuilder() {
  const build = vi.fn(async (_pages: readonly CbzPage[]): Promise<Buffer> => {
    return CBZ_BYTES;
  });
  const cbzBuilder: CbzBuilder = { build };
  return { cbzBuilder, build };
}

// Resolve each in-flight page in reverse start order (latest-started completes
// first) until the whole build finishes, so completion order deliberately does
// not match source order. Asserts the pool never exceeds the configured bound.
async function drainReverse(
  s: ReturnType<typeof makeGatedSuwayomi>,
  bound: number,
): Promise<void> {
  const resolved = new Set<number>();
  await settle();
  while (resolved.size < PAGE_COUNT) {
    expect(s.inFlight()).toBeLessThanOrEqual(bound);
    const pending = [...s.started()].filter((i) => !resolved.has(i));
    const pick = Math.max(...pending);
    resolved.add(pick);
    s.resolve(pick);
    await settle();
  }
}

describe("ReaderService.readCbz — bounded-concurrency page build", () => {
  function makeCache() {
    const entries = new Map<string, CachedPage>();
    const k = (id: string, profile: ImageProfile) => `${id}|${profile}`;
    const get = vi.fn((id: string, profile: ImageProfile) =>
      entries.get(k(id, profile)),
    );
    const set = vi.fn((id: string, profile: ImageProfile, page: CachedPage) => {
      entries.set(k(id, profile), page);
    });
    const cache: SessionCache = { get, set };
    return { cache };
  }

  it("keeps up to the configured number of pages in flight, but never more", async () => {
    const s = makeGatedSuwayomi(PAGE_COUNT);
    const { imageProcessor } = makeImageProcessor();
    const { cbzBuilder } = makeCbzBuilder();
    const { cache } = makeCache();
    const service = new ReaderService(
      s.suwayomi,
      imageProcessor,
      cbzBuilder,
      cache,
      CONCURRENCY,
    );

    const done = service.readCbz(CHAPTER_ID, "eink");

    // Before releasing any page: the pool fans out concurrently (not serial),
    // and stops exactly at the bound.
    await settle();
    expect(s.maxInFlight()).toBe(CONCURRENCY);
    expect(s.inFlight()).toBe(CONCURRENCY);

    await drainReverse(s, CONCURRENCY);
    await done;

    expect(s.maxInFlight()).toBe(CONCURRENCY);
  });

  it("assembles pages in source order regardless of completion order", async () => {
    const s = makeGatedSuwayomi(PAGE_COUNT);
    const { imageProcessor } = makeImageProcessor();
    const { cbzBuilder, build } = makeCbzBuilder();
    const { cache } = makeCache();
    const service = new ReaderService(
      s.suwayomi,
      imageProcessor,
      cbzBuilder,
      cache,
      CONCURRENCY,
    );

    const done = service.readCbz(CHAPTER_ID, "eink");
    await drainReverse(s, CONCURRENCY);
    await done;

    expect(s.fetchPageUrls).toHaveBeenCalledTimes(1);
    expect(s.fetchPageBytes).toHaveBeenCalledTimes(PAGE_COUNT);

    const builtPages = build.mock.calls[0][0] as CbzPage[];
    expect(builtPages.map((p) => p.bytes.toString())).toEqual([
      "proc-raw-0",
      "proc-raw-1",
      "proc-raw-2",
      "proc-raw-3",
      "proc-raw-4",
      "proc-raw-5",
    ]);
  });
});

describe("DownloadService.download — bounded-concurrency page build", () => {
  function makeStore() {
    const files = new Map<string, Buffer>();
    const save = vi.fn(async (chapterId: string, cbz: Buffer) => {
      files.set(chapterId, cbz);
      return `/downloads/${chapterId}.cbz`;
    });
    const read = vi.fn(async (chapterId: string) => files.get(chapterId));
    const store: DownloadStore = { save, read };
    return { store };
  }

  function makeRepo() {
    const rows = new Map<string, DownloadRecord>();
    const get = vi.fn((chapterId: string) => rows.get(chapterId));
    const list = vi.fn(() => [...rows.values()]);
    const create = vi.fn((record: DownloadRecord) => {
      if (!rows.has(record.chapterId)) rows.set(record.chapterId, record);
    });
    const updateStatus = vi.fn();
    const repo: DownloadsRepository = { get, list, create, updateStatus };
    return { repo };
  }

  it("keeps up to the configured number of pages in flight, but never more", async () => {
    const s = makeGatedSuwayomi(PAGE_COUNT);
    const { imageProcessor } = makeImageProcessor();
    const { cbzBuilder } = makeCbzBuilder();
    const { store } = makeStore();
    const { repo } = makeRepo();
    const service = new DownloadService(
      s.suwayomi,
      imageProcessor,
      cbzBuilder,
      store,
      repo,
      CONCURRENCY,
    );

    const done = service.download(CHAPTER_ID, MANGA_ID, "eink");

    await settle();
    expect(s.maxInFlight()).toBe(CONCURRENCY);
    expect(s.inFlight()).toBe(CONCURRENCY);

    await drainReverse(s, CONCURRENCY);
    await done;

    expect(s.maxInFlight()).toBe(CONCURRENCY);
  });

  it("assembles pages in source order regardless of completion order", async () => {
    const s = makeGatedSuwayomi(PAGE_COUNT);
    const { imageProcessor } = makeImageProcessor();
    const { cbzBuilder, build } = makeCbzBuilder();
    const { store } = makeStore();
    const { repo } = makeRepo();
    const service = new DownloadService(
      s.suwayomi,
      imageProcessor,
      cbzBuilder,
      store,
      repo,
      CONCURRENCY,
    );

    const done = service.download(CHAPTER_ID, MANGA_ID, "eink");
    await drainReverse(s, CONCURRENCY);
    await done;

    const builtPages = build.mock.calls[0][0] as CbzPage[];
    expect(builtPages.map((p) => p.bytes.toString())).toEqual([
      "proc-raw-0",
      "proc-raw-1",
      "proc-raw-2",
      "proc-raw-3",
      "proc-raw-4",
      "proc-raw-5",
    ]);
  });
});

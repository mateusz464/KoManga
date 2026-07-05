import { describe, expect, it, vi } from "vitest";
import { PageService } from "../../src/services/page-service.js";
import {
  SuwayomiError,
  type PageRef,
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
  CachedPage,
  SessionCache,
} from "../../src/services/ports/session-cache.js";

// Requesting page N warms the next `prefetchWindow` pages of the same chapter
// into the session cache in the background, without blocking page N's response.
// Page ids are "<chapterId>:<index>" (0-based), so a 93-page chapter has valid
// indices 0..92.
const CHAPTER = "77";
const PAGE_COUNT = 93;

const SOURCE: RawPage = {
  bytes: Buffer.from("raw-source-bytes"),
  contentType: "image/jpeg",
};

// Distinct from SOURCE so a stored/served value can be proven to be the
// processor's output, not the raw source passed straight through.
const PROCESSED: ProcessedImage = {
  bytes: Buffer.from("processed-output-bytes"),
  contentType: "image/png",
};

function ref(chapterId: string, pageIndex: number): PageRef {
  return { chapterId, pageIndex };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// A session-cache fake that genuinely stores (so prefetched pages can later be
// served as hits) while still spying on get/set. Keyed by id + profile, matching
// the port's contract that raw and eink of one page are distinct entries.
class FakeSessionCache implements SessionCache {
  readonly store = new Map<string, CachedPage>();

  readonly get = vi.fn(
    (pageId: string, profile: ImageProfile): CachedPage | undefined =>
      this.store.get(key(pageId, profile)),
  );

  readonly set = vi.fn(
    (pageId: string, profile: ImageProfile, page: CachedPage): void => {
      this.store.set(key(pageId, profile), page);
    },
  );

  /** Seed an entry without recording it as a set() call. */
  seed(pageId: string, profile: ImageProfile, page: CachedPage): void {
    this.store.set(key(pageId, profile), page);
  }
}

function key(pageId: string, profile: ImageProfile): string {
  return `${pageId} ${profile}`;
}

function buildSuwayomi(
  fetchPage: SuwayomiClient["fetchPage"],
  pageCount = PAGE_COUNT,
): SuwayomiClient {
  const unexpected = vi.fn(async () => {
    throw new Error("unexpected Suwayomi call");
  });
  return {
    listSources: unexpected,
    search: unexpected,
    getMangaDetails: unexpected,
    listChapters: unexpected,
    fetchChapters: unexpected,
    getChapterPageCount: vi.fn(async (_chapterId: string) => pageCount),
    fetchPageUrls: unexpected,
    fetchPageBytes: unexpected,
    fetchPage,
    fetchCover: unexpected,
  };
}

function buildProcessor(): ImageProcessor {
  return {
    process: vi.fn(
      async (
        _source: SourceImage,
        _profile: ImageProfile,
      ): Promise<ProcessedImage> => PROCESSED,
    ),
  };
}

describe("PageService background prefetch", () => {
  it("warms the next `window` pages of the chapter into the cache", async () => {
    const cache = new FakeSessionCache();
    const fetchPage = vi.fn(async (_ref: PageRef) => SOURCE);
    const processor = buildProcessor();
    const service = new PageService(
      buildSuwayomi(fetchPage),
      processor,
      cache,
      3,
    );

    await service.getPage(`${CHAPTER}:0`, "raw");

    // Prefetch is asynchronous; wait for the window to settle in the cache.
    await vi.waitFor(() =>
      expect(cache.store.has(`${CHAPTER}:3 raw`)).toBe(true),
    );

    for (const index of [1, 2, 3]) {
      expect(fetchPage).toHaveBeenCalledWith(ref(CHAPTER, index));
      expect(cache.set).toHaveBeenCalledWith(
        `${CHAPTER}:${index}`,
        "raw",
        PROCESSED,
      );
    }
    expect(processor.process).toHaveBeenCalledWith(SOURCE, "raw");
    // Did not overshoot the window.
    expect(fetchPage).not.toHaveBeenCalledWith(ref(CHAPTER, 4));
  });

  it("does not make page N's response wait on prefetch", async () => {
    const cache = new FakeSessionCache();
    const gate = deferred<RawPage>();
    // Page N (index 0) resolves immediately; every prefetch fetch hangs on the
    // gate so it cannot complete until we let it.
    const fetchPage = vi.fn(async (r: PageRef) =>
      r.pageIndex === 0 ? SOURCE : gate.promise,
    );
    const service = new PageService(
      buildSuwayomi(fetchPage),
      buildProcessor(),
      cache,
      3,
    );

    const served = await service.getPage(`${CHAPTER}:0`, "raw");

    // Page N is served from its own fetch + process, not from the stalled
    // prefetch: the call resolves while prefetch is still pending.
    expect(served.bytes.equals(PROCESSED.bytes)).toBe(true);
    expect(served.contentType).toBe(PROCESSED.contentType);
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(`${CHAPTER}:0`, "raw", PROCESSED);
    expect(cache.store.has(`${CHAPTER}:1 raw`)).toBe(false);

    // Once the upstream responds, the background prefetch completes.
    gate.resolve(SOURCE);
    await vi.waitFor(() =>
      expect(cache.store.has(`${CHAPTER}:1 raw`)).toBe(true),
    );
  });

  it("prefetched pages produce cache hits when later requested", async () => {
    const cache = new FakeSessionCache();
    const fetchPage = vi.fn(async (_ref: PageRef) => SOURCE);
    const service = new PageService(
      buildSuwayomi(fetchPage),
      buildProcessor(),
      cache,
      3,
    );

    // Reading page 0 warms pages 1..3 in the background.
    await service.getPage(`${CHAPTER}:0`, "raw");
    await vi.waitFor(() =>
      expect(cache.store.has(`${CHAPTER}:1 raw`)).toBe(true),
    );

    // Advancing to page 1 is served from the cache — it is not fetched again.
    const served = await service.getPage(`${CHAPTER}:1`, "raw");

    expect(served.bytes.equals(PROCESSED.bytes)).toBe(true);
    const index1Fetches = fetchPage.mock.calls.filter(
      ([r]) => r.chapterId === CHAPTER && r.pageIndex === 1,
    ).length;
    expect(index1Fetches).toBe(1); // only the earlier prefetch fetched it
  });

  it.each([
    { window: 2, expected: [1, 2] },
    { window: 5, expected: [1, 2, 3, 4, 5] },
  ])(
    "prefetches exactly the configured window of $window pages",
    async ({ window, expected }) => {
      const cache = new FakeSessionCache();
      const fetchPage = vi.fn(async (_ref: PageRef) => SOURCE);
      const service = new PageService(
        buildSuwayomi(fetchPage),
        buildProcessor(),
        cache,
        window,
      );

      await service.getPage(`${CHAPTER}:0`, "raw");
      const last = expected[expected.length - 1];
      await vi.waitFor(() =>
        expect(cache.store.has(`${CHAPTER}:${last} raw`)).toBe(true),
      );

      const prefetched = [...cache.store.keys()]
        .filter((k) => k !== `${CHAPTER}:0 raw`)
        .sort();
      expect(prefetched).toEqual(
        expected.map((i) => `${CHAPTER}:${i} raw`).sort(),
      );
    },
  );

  it("does not prefetch past the last page of the chapter", async () => {
    const cache = new FakeSessionCache();
    const fetchPage = vi.fn(async (_ref: PageRef) => SOURCE);
    // 93 pages → valid indices 0..92. Requesting index 91 with window 3 leaves
    // only index 92 to prefetch.
    const service = new PageService(
      buildSuwayomi(fetchPage, 93),
      buildProcessor(),
      cache,
      3,
    );

    await service.getPage(`${CHAPTER}:91`, "raw");
    await vi.waitFor(() =>
      expect(cache.store.has(`${CHAPTER}:92 raw`)).toBe(true),
    );

    expect(fetchPage).toHaveBeenCalledWith(ref(CHAPTER, 92));
    expect(fetchPage).not.toHaveBeenCalledWith(ref(CHAPTER, 93));
    expect(fetchPage).not.toHaveBeenCalledWith(ref(CHAPTER, 94));
  });

  it("prefetches under the same profile as the served request", async () => {
    const cache = new FakeSessionCache();
    const fetchPage = vi.fn(async (_ref: PageRef) => SOURCE);
    const processor = buildProcessor();
    const service = new PageService(
      buildSuwayomi(fetchPage),
      processor,
      cache,
      2,
    );

    await service.getPage(`${CHAPTER}:0`, "eink");
    await vi.waitFor(() =>
      expect(cache.store.has(`${CHAPTER}:2 eink`)).toBe(true),
    );

    expect(processor.process).toHaveBeenCalledWith(SOURCE, "eink");
    expect(cache.set).toHaveBeenCalledWith(`${CHAPTER}:1`, "eink", PROCESSED);
    // Prefetch must not cross profiles.
    expect(cache.store.has(`${CHAPTER}:1 raw`)).toBe(false);
  });

  it("skips prefetching pages already in the cache", async () => {
    const cache = new FakeSessionCache();
    cache.seed(`${CHAPTER}:1`, "raw", PROCESSED); // already cached
    const fetchPage = vi.fn(async (_ref: PageRef) => SOURCE);
    const service = new PageService(
      buildSuwayomi(fetchPage),
      buildProcessor(),
      cache,
      3,
    );

    await service.getPage(`${CHAPTER}:0`, "raw");
    await vi.waitFor(() =>
      expect(cache.store.has(`${CHAPTER}:3 raw`)).toBe(true),
    );

    // The already-cached page is not refetched; the rest of the window is.
    expect(fetchPage).not.toHaveBeenCalledWith(ref(CHAPTER, 1));
    expect(fetchPage).toHaveBeenCalledWith(ref(CHAPTER, 2));
    expect(fetchPage).toHaveBeenCalledWith(ref(CHAPTER, 3));
  });

  it("ignores prefetch failures without affecting the served page", async () => {
    const cache = new FakeSessionCache();
    // Page N succeeds; every prefetch fetch fails upstream.
    const fetchPage = vi.fn(async (r: PageRef) => {
      if (r.pageIndex === 0) return SOURCE;
      throw new SuwayomiError();
    });
    const service = new PageService(
      buildSuwayomi(fetchPage),
      buildProcessor(),
      cache,
      3,
    );

    // The served page resolves normally despite the failing prefetch.
    const served = await service.getPage(`${CHAPTER}:0`, "raw");
    expect(served.bytes.equals(PROCESSED.bytes)).toBe(true);

    // Prefetch is attempted in the background and swallows the failure: nothing
    // is cached for the failed page and no unhandled rejection escapes.
    await vi.waitFor(() =>
      expect(fetchPage).toHaveBeenCalledWith(ref(CHAPTER, 1)),
    );
    expect(cache.store.has(`${CHAPTER}:1 raw`)).toBe(false);
  });

  it("does not prefetch when the window is zero", async () => {
    const cache = new FakeSessionCache();
    const fetchPage = vi.fn(async (_ref: PageRef) => SOURCE);
    const service = new PageService(
      buildSuwayomi(fetchPage),
      buildProcessor(),
      cache,
      0,
    );

    await service.getPage(`${CHAPTER}:0`, "raw");
    // Give any (incorrect) background work a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Only page N itself was fetched and stored.
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(ref(CHAPTER, 0));
    expect(cache.store.has(`${CHAPTER}:1 raw`)).toBe(false);
  });
});

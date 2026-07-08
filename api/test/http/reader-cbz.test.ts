import { describe, expect, it, vi } from "vitest";
import request, { type Response } from "supertest";
import type { IncomingMessage } from "node:http";
import { createApp } from "../../src/http/app.js";
import {
  SuwayomiError,
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

// The transient reader path: GET /api/chapter/:id/cbz builds + serves an eink CBZ
// from the ephemeral session cache and records nothing, while POST
// /api/chapter/:id/download stays the explicit, persisted, listed path (RFC §5.2).

const CHAPTER_ID = "77";
const MANGA_ID = "42";
const PAGE_COUNT = 3;

// A built CBZ archive (opaque bytes here — the real archive format is the
// ZipCbzBuilder's concern, API-503/504).
const CBZ_BYTES = Buffer.from("PK-fake-cbz-archive-bytes");
const CBZ_CONTENT_TYPE = "application/vnd.comicbook+zip";

// superagent has no parser for binary responses, so buffer the body ourselves
// for the byte-level CBZ assertions (same helper as the download/page tests).
function binaryParser(
  res: Response,
  cb: (err: Error | null, body: Buffer) => void,
): void {
  const stream = res as unknown as IncomingMessage;
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on("end", () => cb(null, Buffer.concat(chunks)));
}

// A stateful in-memory DownloadsRepository fake so "read persists nothing" and
// "explicit download lists exactly once" can be observed across calls.
function makeRepo(seed: DownloadRecord[] = []) {
  const rows = new Map<string, DownloadRecord>();
  for (const r of seed) rows.set(r.chapterId, r);

  const get = vi.fn((chapterId: string) => rows.get(chapterId));
  const list = vi.fn(() => [...rows.values()]);
  const create = vi.fn((record: DownloadRecord) => {
    if (!rows.has(record.chapterId)) rows.set(record.chapterId, record);
  });
  const updateStatus = vi.fn(
    (chapterId: string, status: DownloadRecord["status"]) => {
      const existing = rows.get(chapterId);
      if (existing) rows.set(chapterId, { ...existing, status });
    },
  );

  const repo: DownloadsRepository = { get, list, create, updateStatus };
  return { repo, get, list, create, updateStatus, rows };
}

// A stateful in-memory DownloadStore fake so we can prove the transient read
// path never writes to the persistent volume.
function makeStore(seed: Record<string, Buffer> = {}) {
  const files = new Map<string, Buffer>(Object.entries(seed));

  const save = vi.fn(
    async (chapterId: string, cbz: Buffer): Promise<string> => {
      files.set(chapterId, cbz);
      return `/downloads/${chapterId}.cbz`;
    },
  );
  const read = vi.fn(async (chapterId: string) => files.get(chapterId));

  const store: DownloadStore = { save, read };
  return { store, save, read, files };
}

// A stateful in-memory SessionCache fake keyed by (key + profile), so a re-read
// can be served from the cache without rebuilding. The exact key string is the
// implementation's concern — we only require it be consistent between set/get,
// which the round-trip assertions prove without coupling to it.
function makeCache() {
  const entries = new Map<string, CachedPage>();
  const k = (pageId: string, profile: ImageProfile) => `${pageId}|${profile}`;

  const get = vi.fn((pageId: string, profile: ImageProfile) =>
    entries.get(k(pageId, profile)),
  );
  const set = vi.fn(
    (pageId: string, profile: ImageProfile, page: CachedPage) => {
      entries.set(k(pageId, profile), page);
    },
  );

  const cache: SessionCache = { get, set };
  return { cache, get, set, entries };
}

interface DepsOptions {
  repoSeed?: DownloadRecord[];
  storeSeed?: Record<string, Buffer>;
  pageCount?: number;
  fetchError?: unknown;
}

function buildDeps(options: DepsOptions = {}) {
  const { repo, get, list, create } = makeRepo(options.repoSeed);
  const { store, save, read } = makeStore(options.storeSeed);
  const { cache, get: cacheGet, set: cacheSet } = makeCache();

  // A page URL encodes its index so fetchPageBytes can tag its bytes and the
  // built page order stays checkable; the resolution runs once per build.
  const pageUrl = (index: number) => `url-${index}`;
  const fetchPageUrls = vi.fn(async (_chapterId: string): Promise<string[]> => {
    if (options.fetchError !== undefined) throw options.fetchError;
    const count = options.pageCount ?? PAGE_COUNT;
    return Array.from({ length: count }, (_v, i) => pageUrl(i));
  });
  const fetchPageBytes = vi.fn(async (url: string): Promise<RawPage> => {
    return {
      bytes: Buffer.from(`raw-${url.replace("url-", "")}`),
      contentType: "image/jpeg",
    };
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

  // process tags its output with the requested profile so the built page order
  // and the negotiated profile are both checkable.
  const capturedProfiles: ImageProfile[] = [];
  const process = vi.fn(
    async (
      source: SourceImage,
      profile: ImageProfile,
    ): Promise<ProcessedImage> => {
      capturedProfiles.push(profile);
      return {
        bytes: Buffer.concat([Buffer.from("proc-"), source.bytes]),
        contentType: "image/png",
      };
    },
  );
  const imageProcessor: ImageProcessor = { process };

  const build = vi.fn(async (_pages: readonly CbzPage[]): Promise<Buffer> => {
    return CBZ_BYTES;
  });
  const cbzBuilder: CbzBuilder = { build };

  return {
    deps: {
      suwayomi,
      imageProcessor,
      sessionCache: cache,
      cbzBuilder,
      downloadStore: store,
      downloadsRepository: repo,
    },
    fetchPageUrls,
    fetchPageBytes,
    process,
    capturedProfiles,
    build,
    save,
    read,
    repoGet: get,
    repoList: list,
    repoCreate: create,
    cacheGet,
    cacheSet,
  };
}

function appFrom(deps: ReturnType<typeof buildDeps>["deps"]) {
  return createApp(deps);
}

function readCbz(
  deps: ReturnType<typeof buildDeps>["deps"],
  query = "?profile=eink",
) {
  return request(appFrom(deps))
    .get(`/api/chapter/${CHAPTER_ID}/cbz${query}`)
    .buffer(true)
    .parse(binaryParser);
}

describe("GET /api/chapter/:id/cbz (transient reader path)", () => {
  it("serves the eink CBZ bytes with the comic-book-archive content type", async () => {
    const d = buildDeps();

    const res = await readCbz(d.deps);

    expect(res.status).toBe(200);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.equals(CBZ_BYTES)).toBe(true);
    expect(res.headers["content-type"]).toContain(CBZ_CONTENT_TYPE);
  });

  it("builds the CBZ from every page, processed in chapter order under the eink profile", async () => {
    const d = buildDeps();

    await readCbz(d.deps);

    // Page URLs are resolved exactly once for the whole chapter (no N+1), then
    // each page's bytes are fetched by URL in chapter order.
    expect(d.fetchPageUrls).toHaveBeenCalledTimes(1);
    expect(d.fetchPageUrls).toHaveBeenCalledWith(CHAPTER_ID);
    expect(d.fetchPageBytes).toHaveBeenCalledTimes(PAGE_COUNT);
    for (let i = 0; i < PAGE_COUNT; i++) {
      expect(d.fetchPageBytes).toHaveBeenNthCalledWith(i + 1, `url-${i}`);
    }
    // Profile-negotiated: every page is processed under eink (RFC §6).
    expect(d.capturedProfiles).toEqual(["eink", "eink", "eink"]);

    // The processed pages reach the builder in chapter order.
    const builtPages = d.build.mock.calls[0][0] as CbzPage[];
    expect(builtPages.map((p) => p.bytes.toString())).toEqual([
      "proc-raw-0",
      "proc-raw-1",
      "proc-raw-2",
    ]);
  });

  it("records nothing: reading does not touch the persistent store or repository", async () => {
    const d = buildDeps();

    const res = await readCbz(d.deps);
    expect(res.status).toBe(200);

    // The whole point of the split (RFC §5.2): the transient path is ephemeral.
    expect(d.save).not.toHaveBeenCalled();
    expect(d.repoCreate).not.toHaveBeenCalled();

    // GET /api/downloads stays empty afterwards.
    const listed = await request(appFrom(d.deps)).get("/api/downloads");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ data: [] });
  });

  it("caches the built CBZ in the ephemeral session cache", async () => {
    const d = buildDeps();

    await readCbz(d.deps);

    // The archive is cached under the eink profile (not the persistent store).
    expect(d.cacheSet).toHaveBeenCalledTimes(1);
    const [, cachedProfile, cachedPage] = d.cacheSet.mock.calls[0];
    expect(cachedProfile).toBe("eink");
    expect(cachedPage.bytes.equals(CBZ_BYTES)).toBe(true);
    expect(cachedPage.contentType).toContain(CBZ_CONTENT_TYPE);
  });

  it("serves a re-read from the session cache without rebuilding", async () => {
    const d = buildDeps();

    const first = await readCbz(d.deps);
    expect(first.status).toBe(200);
    expect(d.build).toHaveBeenCalledTimes(1);

    const second = await readCbz(d.deps);
    expect(second.status).toBe(200);
    expect(second.body.equals(CBZ_BYTES)).toBe(true);

    // The second read is a cache hit: no refetch, reprocess or rebuild.
    expect(d.build).toHaveBeenCalledTimes(1);
    expect(d.fetchPageUrls).toHaveBeenCalledTimes(1);
    expect(d.fetchPageBytes).toHaveBeenCalledTimes(PAGE_COUNT);
    expect(d.process).toHaveBeenCalledTimes(PAGE_COUNT);
    expect(d.cacheGet).toHaveBeenCalled();
  });

  it("rejects an unsupported profile at the edge (400) without building anything", async () => {
    const d = buildDeps();

    const res = await request(appFrom(d.deps)).get(
      `/api/chapter/${CHAPTER_ID}/cbz?profile=sepia`,
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "BAD_REQUEST", message: expect.any(String) },
    });
    expect(d.fetchPageUrls).not.toHaveBeenCalled();
    expect(d.build).not.toHaveBeenCalled();
  });

  it("propagates an upstream failure as the 502 error envelope", async () => {
    const d = buildDeps({ fetchError: new SuwayomiError() });

    const res = await request(appFrom(d.deps)).get(
      `/api/chapter/${CHAPTER_ID}/cbz?profile=eink`,
    );

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      error: { code: "SUWAYOMI_ERROR", message: expect.any(String) },
    });
  });
});

describe("reader CBZ vs. explicit download: no cross-contamination", () => {
  it("a chapter read then explicitly downloaded is listed exactly once", async () => {
    const d = buildDeps();
    const app = appFrom(d.deps);

    // Read it (transient) — records nothing.
    const read = await request(app)
      .get(`/api/chapter/${CHAPTER_ID}/cbz?profile=eink`)
      .buffer(true)
      .parse(binaryParser);
    expect(read.status).toBe(200);

    let listed = await request(app).get("/api/downloads");
    expect(listed.body).toEqual({ data: [] });

    // Explicitly download it — persists exactly one record.
    const dl = await request(app).post(
      `/api/chapter/${CHAPTER_ID}/download?mangaId=${MANGA_ID}&profile=eink`,
    );
    expect(dl.status).toBe(200);

    listed = await request(app).get("/api/downloads");
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).toMatchObject({
      chapterId: CHAPTER_ID,
      mangaId: MANGA_ID,
      status: "completed",
    });
    // The record came from the explicit download, not the read.
    expect(d.repoCreate).toHaveBeenCalledTimes(1);
    expect(d.save).toHaveBeenCalledTimes(1);
  });

  it("explicit POST /download still persists and lists a record (unchanged)", async () => {
    const d = buildDeps();
    const app = appFrom(d.deps);

    const res = await request(app).post(
      `/api/chapter/${CHAPTER_ID}/download?mangaId=${MANGA_ID}`,
    );
    expect(res.status).toBe(200);
    expect(d.repoCreate).toHaveBeenCalledTimes(1);

    const listed = await request(app).get("/api/downloads");
    expect(listed.body.data).toHaveLength(1);
  });
});

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
import type { SessionCache } from "../../src/services/ports/session-cache.js";

// Download endpoints: POST /api/chapter/:id/download builds a CBZ, stores it on
// the persistent volume and records it; GET /api/downloads lists records; GET
// /api/downloads/:chapterId serves a stored CBZ from the store, not the cache.
// `mangaId` is a required query param (missing → 400); re-download is idempotent.

const CHAPTER_ID = "77";
const MANGA_ID = "42";
const PAGE_COUNT = 3;

// A built CBZ archive (opaque bytes here — the real archive format is the
// ZipCbzBuilder's concern, API-503/504).
const CBZ_BYTES = Buffer.from("PK-fake-cbz-archive-bytes");
const CBZ_PATH = `/downloads/${CHAPTER_ID}.cbz`;
const CBZ_CONTENT_TYPE = "application/vnd.comicbook+zip";

// superagent has no parser for binary responses, so buffer the body ourselves
// for the byte-level CBZ assertions (same helper as the page endpoint test).
function binaryParser(
  res: Response,
  cb: (err: Error | null, body: Buffer) => void,
): void {
  const stream = res as unknown as IncomingMessage;
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on("end", () => cb(null, Buffer.concat(chunks)));
}

// A stateful in-memory DownloadsRepository fake (one row per chapter,
// idempotent create) so re-download and list behaviour can be observed across
// calls within a test, mirroring the API-501 contract.
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

// A stateful in-memory DownloadStore fake so a saved CBZ can be read back and
// served within the same test.
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

interface DepsOptions {
  repoSeed?: DownloadRecord[];
  storeSeed?: Record<string, Buffer>;
  pageCount?: number;
  fetchError?: unknown;
}

function buildDeps(options: DepsOptions = {}) {
  const { repo, get, list, create } = makeRepo(options.repoSeed);
  const { store, save, read } = makeStore(options.storeSeed);

  // The chapter's page URLs are resolved once; each URL encodes its index so
  // fetchPageBytes can tag its bytes and the built page order stays checkable.
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

  // process echoes the source bytes (tagged) so the built page order is checkable.
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

  // A spied session cache so we can prove the download serve path never touches
  // the ephemeral cache (criterion: served from the persistent store).
  const cacheGet = vi.fn(() => undefined);
  const cacheSet = vi.fn();
  const sessionCache: SessionCache = { get: cacheGet, set: cacheSet };

  return {
    deps: {
      suwayomi,
      imageProcessor,
      sessionCache,
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
  };
}

function appFrom(deps: ReturnType<typeof buildDeps>["deps"]) {
  return createApp(deps);
}

describe("POST /api/chapter/:id/download", () => {
  it("fetches + processes every page, builds the CBZ, stores it, and records the download", async () => {
    const d = buildDeps();

    const res = await request(appFrom(d.deps)).post(
      `/api/chapter/${CHAPTER_ID}/download?mangaId=${MANGA_ID}`,
    );

    expect(res.status).toBe(200);

    // Page URLs are resolved exactly once for the whole chapter (no N+1), then
    // each page's bytes are fetched by URL in chapter order, then processed.
    expect(d.fetchPageUrls).toHaveBeenCalledTimes(1);
    expect(d.fetchPageUrls).toHaveBeenCalledWith(CHAPTER_ID);
    expect(d.fetchPageBytes).toHaveBeenCalledTimes(PAGE_COUNT);
    for (let i = 0; i < PAGE_COUNT; i++) {
      expect(d.fetchPageBytes).toHaveBeenNthCalledWith(i + 1, `url-${i}`);
    }
    expect(d.process).toHaveBeenCalledTimes(PAGE_COUNT);

    // The processed pages are handed to the builder in chapter order.
    const builtPages = d.build.mock.calls[0][0] as CbzPage[];
    expect(builtPages.map((p) => p.bytes.toString())).toEqual([
      "proc-raw-0",
      "proc-raw-1",
      "proc-raw-2",
    ]);

    // The built archive is written to the persistent store, not the cache.
    expect(d.save).toHaveBeenCalledWith(CHAPTER_ID, CBZ_BYTES);

    // A record is persisted with the path from the store and a completed status.
    expect(d.repoCreate).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({
      data: {
        chapterId: CHAPTER_ID,
        mangaId: MANGA_ID,
        cbzPath: CBZ_PATH,
        status: "completed",
        createdAt: expect.any(Number),
      },
    });
  });

  it("processes pages under the negotiated eink profile", async () => {
    const d = buildDeps();

    const res = await request(appFrom(d.deps)).post(
      `/api/chapter/${CHAPTER_ID}/download?mangaId=${MANGA_ID}&profile=eink`,
    );

    expect(res.status).toBe(200);
    expect(d.capturedProfiles).toEqual(["eink", "eink", "eink"]);
  });

  it("defaults to the raw profile when none is given", async () => {
    const d = buildDeps();

    await request(appFrom(d.deps)).post(
      `/api/chapter/${CHAPTER_ID}/download?mangaId=${MANGA_ID}`,
    );

    expect(d.capturedProfiles).toEqual(["raw", "raw", "raw"]);
  });

  it("is idempotent: re-downloading an existing chapter rebuilds nothing and adds no duplicate", async () => {
    const existing: DownloadRecord = {
      chapterId: CHAPTER_ID,
      mangaId: MANGA_ID,
      cbzPath: CBZ_PATH,
      status: "completed",
      createdAt: 1000,
    };
    const d = buildDeps({
      repoSeed: [existing],
      storeSeed: { [CHAPTER_ID]: CBZ_BYTES },
    });

    const res = await request(appFrom(d.deps)).post(
      `/api/chapter/${CHAPTER_ID}/download?mangaId=${MANGA_ID}`,
    );

    expect(res.status).toBe(200);
    // Returns the already-stored record, untouched.
    expect(res.body).toEqual({ data: existing });
    // No rebuild, no re-store, no duplicate record.
    expect(d.fetchPageUrls).not.toHaveBeenCalled();
    expect(d.fetchPageBytes).not.toHaveBeenCalled();
    expect(d.process).not.toHaveBeenCalled();
    expect(d.build).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
    expect(d.repoCreate).not.toHaveBeenCalled();
    expect(d.repoList()).toHaveLength(1);
  });

  it("rejects a request with no mangaId at the edge (400)", async () => {
    const d = buildDeps();

    const res = await request(appFrom(d.deps)).post(
      `/api/chapter/${CHAPTER_ID}/download`,
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "BAD_REQUEST", message: expect.any(String) },
    });
    // Nothing downstream is touched.
    expect(d.fetchPageUrls).not.toHaveBeenCalled();
    expect(d.repoCreate).not.toHaveBeenCalled();
  });

  it("rejects an unsupported profile at the edge (400)", async () => {
    const d = buildDeps();

    const res = await request(appFrom(d.deps)).post(
      `/api/chapter/${CHAPTER_ID}/download?mangaId=${MANGA_ID}&profile=sepia`,
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "BAD_REQUEST", message: expect.any(String) },
    });
    expect(d.fetchPageUrls).not.toHaveBeenCalled();
  });

  it("propagates an upstream failure as the 502 error envelope", async () => {
    const d = buildDeps({ fetchError: new SuwayomiError() });

    const res = await request(appFrom(d.deps)).post(
      `/api/chapter/${CHAPTER_ID}/download?mangaId=${MANGA_ID}`,
    );

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      error: { code: "SUWAYOMI_ERROR", message: expect.any(String) },
    });
  });
});

describe("GET /api/downloads", () => {
  it("lists the persisted download records", async () => {
    const records: DownloadRecord[] = [
      {
        chapterId: "77",
        mangaId: "42",
        cbzPath: "/downloads/77.cbz",
        status: "completed",
        createdAt: 1000,
      },
      {
        chapterId: "78",
        mangaId: "42",
        cbzPath: "/downloads/78.cbz",
        status: "completed",
        createdAt: 2000,
      },
    ];
    const d = buildDeps({ repoSeed: records });

    const res = await request(appFrom(d.deps)).get("/api/downloads");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: records });
  });

  it("returns an empty list when nothing has been downloaded", async () => {
    const d = buildDeps();

    const res = await request(appFrom(d.deps)).get("/api/downloads");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });
});

describe("GET /api/downloads/:chapterId", () => {
  it("serves the stored CBZ from the persistent store, never the session cache", async () => {
    const record: DownloadRecord = {
      chapterId: CHAPTER_ID,
      mangaId: MANGA_ID,
      cbzPath: CBZ_PATH,
      status: "completed",
      createdAt: 1000,
    };
    const d = buildDeps({
      repoSeed: [record],
      storeSeed: { [CHAPTER_ID]: CBZ_BYTES },
    });

    const res = await request(appFrom(d.deps))
      .get(`/api/downloads/${CHAPTER_ID}`)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.equals(CBZ_BYTES)).toBe(true);
    expect(res.headers["content-type"]).toContain(CBZ_CONTENT_TYPE);

    // The bytes come from the persistent store; the ephemeral cache is untouched.
    expect(d.read).toHaveBeenCalledWith(CHAPTER_ID);
    expect(d.cacheGet).not.toHaveBeenCalled();
  });

  it("returns the 404 error envelope for a chapter that was never downloaded", async () => {
    const d = buildDeps();

    const res = await request(appFrom(d.deps)).get("/api/downloads/999");

    // Asserting the repo was reached keeps this red until the route exists — the
    // generic 404 fallback never looks the download up.
    expect(d.repoGet).toHaveBeenCalledWith("999");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: expect.any(String) },
    });
  });
});

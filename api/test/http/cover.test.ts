import { describe, expect, it, vi } from "vitest";
import { request, type Response } from "../support/http.js";
import type { IncomingMessage } from "node:http";
import { createApp } from "../../src/http/app.js";
import { NotFoundError } from "../../src/http/errors.js";
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
  CachedPage,
  SessionCache,
} from "../../src/services/ports/session-cache.js";

// GET /api/manga/:id/cover?profile= serves the cover through the same
// profile-negotiated, cached image path as pages (fetchCover source, cache key
// `cover:<mangaId>`): profile defaults to raw, eink transforms, else 400; cache
// miss fetches + processes + stores, hit serves without refetch; unknown manga →
// 404, upstream failure → 502. The response is image bytes, not JSON.

const MANGA_ID = "42";
// Cover keys are namespaced so they can never collide with page ids
// ("<chapterId>:<index>").
const COVER_KEY = "cover:42";

const SOURCE: RawPage = {
  bytes: Buffer.from("raw-cover-bytes"),
  contentType: "image/jpeg",
};

// Distinct bytes/type so we can prove the *processed* output is what gets
// served, not the raw source.
const PROCESSED: ProcessedImage = {
  bytes: Buffer.from("processed-cover-bytes"),
  contentType: "image/png",
};

// superagent has no built-in parser for image/* responses, so collect the raw
// body into a Buffer ourselves for the byte-level assertions.
function binaryParser(
  res: Response,
  cb: (err: Error | null, body: Buffer) => void,
): void {
  const stream = res as unknown as IncomingMessage;
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on("end", () => cb(null, Buffer.concat(chunks)));
}

interface CoverDeps {
  suwayomi: SuwayomiClient;
  imageProcessor: ImageProcessor;
  sessionCache: SessionCache;
  fetchCover: ReturnType<typeof vi.fn>;
  process: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
}

// Builds the three port mocks. `cached` is what the session cache serves on
// lookup (undefined = miss); `fetchError` makes the cover fetch reject.
function buildDeps(options: {
  cached?: CachedPage;
  source?: RawPage;
  fetchError?: unknown;
  processed?: ProcessedImage;
}): CoverDeps {
  const get = vi.fn(
    (_key: string, _profile: ImageProfile): CachedPage | undefined =>
      options.cached,
  );
  const set = vi.fn(
    (_key: string, _profile: ImageProfile, _page: CachedPage): void => {},
  );
  const sessionCache: SessionCache = { get, set };

  const fetchCover = vi.fn(async (_mangaId: string): Promise<RawPage> => {
    if (options.fetchError !== undefined) {
      throw options.fetchError;
    }
    return options.source ?? SOURCE;
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
    fetchPageUrls: unexpected,
    fetchPageBytes: unexpected,
    fetchPage: unexpected,
    fetchCover,
  };

  const process = vi.fn(
    async (
      _source: SourceImage,
      _profile: ImageProfile,
    ): Promise<ProcessedImage> => options.processed ?? PROCESSED,
  );
  const imageProcessor: ImageProcessor = { process };

  return {
    suwayomi,
    imageProcessor,
    sessionCache,
    fetchCover,
    process,
    get,
    set,
  };
}

function appFrom(deps: CoverDeps) {
  return createApp({
    suwayomi: deps.suwayomi,
    imageProcessor: deps.imageProcessor,
    sessionCache: deps.sessionCache,
  });
}

describe("GET /api/manga/:id/cover", () => {
  it("defaults to the raw profile and serves the processed bytes on a cache miss", async () => {
    const deps = buildDeps({ cached: undefined });

    const res = await request(appFrom(deps))
      .get(`/api/manga/${MANGA_ID}/cover`)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    // The served body is the processor's output, with its content-type.
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.equals(PROCESSED.bytes)).toBe(true);
    expect(res.headers["content-type"]).toContain(PROCESSED.contentType);

    // Miss → looked up under the default `raw` profile against the namespaced
    // cover key, fetched, processed, stored.
    expect(deps.get).toHaveBeenCalledWith(COVER_KEY, "raw");
    expect(deps.fetchCover).toHaveBeenCalledWith(MANGA_ID);
    expect(deps.process).toHaveBeenCalledWith(SOURCE, "raw");
    expect(deps.set).toHaveBeenCalledWith(COVER_KEY, "raw", PROCESSED);
  });

  it("runs the eink transform and keys the cache by the eink profile", async () => {
    const deps = buildDeps({ cached: undefined });

    const res = await request(appFrom(deps))
      .get(`/api/manga/${MANGA_ID}/cover?profile=eink`)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.body.equals(PROCESSED.bytes)).toBe(true);

    expect(deps.get).toHaveBeenCalledWith(COVER_KEY, "eink");
    expect(deps.process).toHaveBeenCalledWith(SOURCE, "eink");
    expect(deps.set).toHaveBeenCalledWith(COVER_KEY, "eink", PROCESSED);
  });

  it("serves a cache hit without refetching or reprocessing", async () => {
    const hit: CachedPage = {
      bytes: Buffer.from("cached-cover-bytes"),
      contentType: "image/png",
    };
    const deps = buildDeps({ cached: hit });

    const res = await request(appFrom(deps))
      .get(`/api/manga/${MANGA_ID}/cover`)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.body.equals(hit.bytes)).toBe(true);
    expect(res.headers["content-type"]).toContain(hit.contentType);

    // A hit must short-circuit the upstream entirely.
    expect(deps.get).toHaveBeenCalledWith(COVER_KEY, "raw");
    expect(deps.fetchCover).not.toHaveBeenCalled();
    expect(deps.process).not.toHaveBeenCalled();
    expect(deps.set).not.toHaveBeenCalled();
  });

  it("returns the 400 error envelope for an unsupported profile", async () => {
    const deps = buildDeps({ cached: undefined });

    const res = await request(appFrom(deps)).get(
      `/api/manga/${MANGA_ID}/cover?profile=sepia`,
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "BAD_REQUEST", message: expect.any(String) },
    });
    // Rejected at the edge — nothing downstream is touched.
    expect(deps.get).not.toHaveBeenCalled();
    expect(deps.fetchCover).not.toHaveBeenCalled();
    expect(deps.process).not.toHaveBeenCalled();
  });

  it("returns the 404 error envelope when the manga is unknown", async () => {
    const deps = buildDeps({
      cached: undefined,
      fetchError: new NotFoundError("Manga not found"),
    });

    const res = await request(appFrom(deps)).get("/api/manga/999/cover");

    // Asserting the fetch was reached keeps this red until the route exists —
    // the generic 404 fallback never touches the Suwayomi client.
    expect(deps.fetchCover).toHaveBeenCalledWith("999");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: expect.any(String) },
    });
  });

  it("propagates an upstream failure as the 502 error envelope", async () => {
    const deps = buildDeps({
      cached: undefined,
      fetchError: new SuwayomiError(),
    });

    const res = await request(appFrom(deps)).get(
      `/api/manga/${MANGA_ID}/cover`,
    );

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      error: { code: "SUWAYOMI_ERROR", message: expect.any(String) },
    });
  });
});

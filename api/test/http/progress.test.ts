import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import type {
  ReadingProgress,
  ReadingProgressRepository,
} from "../../src/services/ports/reading-progress-repository.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

// Contract test for the reading-progress endpoints (API-601):
//   - GET /api/progress/:mangaId — read the stored reading position for a manga.
//   - PUT /api/progress/:mangaId — write the position (chapter + page + updatedAt),
//                                  last-write-wins by `updatedAt` (RFC §7).
//
// The repository is mocked at the port boundary (CLAUDE.md §4) and injected via
// `createApp`, so this exercises the route → service → port wiring through
// Express, not the SQLite adapter. The endpoints are implemented in API-602 —
// these assertions stay red (404, route unmounted) until then.
//
// Design decisions pinned here (RFC §7, §8 leaves shapes to implementation):
//   - Progress is OWNED by this service and device-agnostic: keyed by manga only,
//     never by a device id. `mangaId` comes from the URL; the PUT body carries
//     only `chapterId`/`page`/`updatedAt`. Any device field in the body is
//     ignored, never persisted.
//   - Last-write-wins lives in the repository (API-501/502 port). The endpoints
//     just forward to `save`/`get`; PUT returns the RESOLVED current position
//     (save then get) so a stale write visibly returns the newer stored value.
//   - Success uses the standard `{ data: ... }` envelope; a manga with no stored
//     progress yet → 404 (the client then starts at the beginning).

const MANGA_ID = "42";

// A stateful in-memory ReadingProgressRepository fake that faithfully implements
// the API-501/502 contract — one row per manga (device-agnostic) and last-write-
// wins by `updatedAt` — so write/read and LWW behaviour are observable across
// calls within a test (mirrors the API-505 stateful-fake pattern).
function makeRepo(seed: ReadingProgress[] = []) {
  const rows = new Map<string, ReadingProgress>();
  for (const r of seed) rows.set(r.mangaId, r);

  const get = vi.fn((mangaId: string) => rows.get(mangaId));
  const save = vi.fn((progress: ReadingProgress) => {
    const existing = rows.get(progress.mangaId);
    // Last-write-wins: a stale write (older updatedAt) must not clobber.
    if (existing === undefined || progress.updatedAt >= existing.updatedAt) {
      rows.set(progress.mangaId, progress);
    }
  });

  const repo: ReadingProgressRepository = { get, save };
  return { repo, get, save, rows };
}

function buildDeps(seed: ReadingProgress[] = []) {
  const { repo, get, save, rows } = makeRepo(seed);
  return {
    deps: {
      suwayomi: stubSuwayomi(),
      readingProgressRepository: repo,
    },
    get,
    save,
    rows,
  };
}

describe("PUT /api/progress/:mangaId", () => {
  it("stores the position and returns it, taking mangaId from the URL", async () => {
    const d = buildDeps();

    const res = await request(createApp(d.deps))
      .put(`/api/progress/${MANGA_ID}`)
      .send({ chapterId: "ch-7", page: 12, updatedAt: 1000 });

    expect(res.status).toBe(200);
    // The saved record is keyed by the URL manga id and carries only our fields.
    expect(d.save).toHaveBeenCalledTimes(1);
    expect(d.save).toHaveBeenCalledWith({
      mangaId: MANGA_ID,
      chapterId: "ch-7",
      page: 12,
      updatedAt: 1000,
    });
    expect(res.body).toEqual({
      data: {
        mangaId: MANGA_ID,
        chapterId: "ch-7",
        page: 12,
        updatedAt: 1000,
      },
    });
  });

  it("PUT then GET returns the stored position", async () => {
    const d = buildDeps();
    const app = createApp(d.deps);

    await request(app)
      .put(`/api/progress/${MANGA_ID}`)
      .send({ chapterId: "ch-3", page: 5, updatedAt: 1000 });

    const res = await request(app).get(`/api/progress/${MANGA_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        mangaId: MANGA_ID,
        chapterId: "ch-3",
        page: 5,
        updatedAt: 1000,
      },
    });
  });

  it("a newer updatedAt overwrites an older one", async () => {
    const d = buildDeps();
    const app = createApp(d.deps);

    await request(app)
      .put(`/api/progress/${MANGA_ID}`)
      .send({ chapterId: "ch-1", page: 1, updatedAt: 1000 });
    await request(app)
      .put(`/api/progress/${MANGA_ID}`)
      .send({ chapterId: "ch-2", page: 9, updatedAt: 2000 });

    const res = await request(app).get(`/api/progress/${MANGA_ID}`);

    expect(res.body).toEqual({
      data: {
        mangaId: MANGA_ID,
        chapterId: "ch-2",
        page: 9,
        updatedAt: 2000,
      },
    });
  });

  it("an older updatedAt does not clobber a newer one; the stale PUT returns the newer position", async () => {
    const d = buildDeps();
    const app = createApp(d.deps);

    await request(app)
      .put(`/api/progress/${MANGA_ID}`)
      .send({ chapterId: "ch-2", page: 9, updatedAt: 2000 });

    // A stale write (older updatedAt) arrives late from another client.
    const staleRes = await request(app)
      .put(`/api/progress/${MANGA_ID}`)
      .send({ chapterId: "ch-1", page: 1, updatedAt: 1000 });

    // It succeeds but resolves to the newer stored position, not the stale one.
    expect(staleRes.status).toBe(200);
    expect(staleRes.body).toEqual({
      data: {
        mangaId: MANGA_ID,
        chapterId: "ch-2",
        page: 9,
        updatedAt: 2000,
      },
    });

    const res = await request(app).get(`/api/progress/${MANGA_ID}`);
    expect(res.body.data).toEqual({
      mangaId: MANGA_ID,
      chapterId: "ch-2",
      page: 9,
      updatedAt: 2000,
    });
  });

  it("is device-agnostic: a device identifier in the body is ignored, never persisted", async () => {
    const d = buildDeps();

    const res = await request(createApp(d.deps))
      .put(`/api/progress/${MANGA_ID}`)
      .send({
        chapterId: "ch-7",
        page: 12,
        updatedAt: 1000,
        deviceId: "kobo-clara",
      });

    expect(res.status).toBe(200);
    // The saved record has exactly our four fields — no device id leaks in.
    const saved = d.save.mock.calls[0][0];
    expect(Object.keys(saved).sort()).toEqual([
      "chapterId",
      "mangaId",
      "page",
      "updatedAt",
    ]);
    expect(res.body.data).not.toHaveProperty("deviceId");
  });

  it("rejects a body missing chapterId at the edge (400)", async () => {
    const d = buildDeps();

    const res = await request(createApp(d.deps))
      .put(`/api/progress/${MANGA_ID}`)
      .send({ page: 12, updatedAt: 1000 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "BAD_REQUEST", message: expect.any(String) },
    });
    expect(d.save).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric page at the edge (400)", async () => {
    const d = buildDeps();

    const res = await request(createApp(d.deps))
      .put(`/api/progress/${MANGA_ID}`)
      .send({ chapterId: "ch-7", page: "twelve", updatedAt: 1000 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "BAD_REQUEST", message: expect.any(String) },
    });
    expect(d.save).not.toHaveBeenCalled();
  });

  it("rejects a missing updatedAt at the edge (400)", async () => {
    const d = buildDeps();

    const res = await request(createApp(d.deps))
      .put(`/api/progress/${MANGA_ID}`)
      .send({ chapterId: "ch-7", page: 12 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "BAD_REQUEST", message: expect.any(String) },
    });
    expect(d.save).not.toHaveBeenCalled();
  });
});

describe("GET /api/progress/:mangaId", () => {
  it("returns the stored position for a manga", async () => {
    const stored: ReadingProgress = {
      mangaId: MANGA_ID,
      chapterId: "ch-5",
      page: 3,
      updatedAt: 4000,
    };
    const d = buildDeps([stored]);

    const res = await request(createApp(d.deps)).get(
      `/api/progress/${MANGA_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: stored });
  });

  it("returns the 404 envelope for a manga with no stored progress", async () => {
    const d = buildDeps();

    const res = await request(createApp(d.deps)).get("/api/progress/999");

    // Asserting the repo was reached keeps this red until the route exists — the
    // generic 404 fallback never looks the progress up.
    expect(d.get).toHaveBeenCalledWith("999");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: expect.any(String) },
    });
  });
});

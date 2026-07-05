import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import type {
  LibraryEntry,
  LibraryRepository,
} from "../../src/services/ports/library-repository.js";
import type { ReadingProgressRepository } from "../../src/services/ports/reading-progress-repository.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

// Contract test for the library / follows endpoints (API-603):
//   - GET    /api/library            — list the followed manga.
//   - PUT    /api/library/:mangaId   — follow a manga (idempotent).
//   - DELETE /api/library/:mangaId   — unfollow a manga (no-op if absent).
//
// The repository is mocked at the port boundary (CLAUDE.md §4) and injected via
// `createApp`, so this exercises the route → service → port wiring through
// Express, not the SQLite adapter. The endpoints are implemented in API-604 —
// these assertions stay red (404, router unmounted) until then.
//
// Design decisions pinned here (RFC §7, §8 leaves shapes to implementation):
//   - The library is OURS and device-agnostic: keyed by manga only, never by a
//     device id. `mangaId` comes from the URL. An entry stores only the
//     reference + when it was followed — never Suwayomi catalogue metadata,
//     which is fetched on demand (CLAUDE.md §8).
//   - `addedAt` (epoch ms) is supplied by the client in the PUT body, mirroring
//     progress's `updatedAt` — device-agnostic and a stable sort key.
//   - Follow is idempotent (re-following keeps one row); unfollow on an absent
//     manga is a no-op. Both resolve to 200 with the standard `{ data: ... }`
//     envelope; the empty library is `{ data: [] }`.
//
// API-907 extends the contract: a follow also captures the manga's display
// `title` (so a client's library/home view can show the name, not the raw id —
// KRP-604/605), persisted on the row and returned by `list()` with no per-entry
// Suwayomi fan-out (CLAUDE.md §8). `title` is optional so an old title-less
// follow degrades gracefully. These title assertions stay red until API-908
// threads `title` through the route/service/repository.

const MANGA_ID = "42";
const TITLE = "One Piece";

// A stateful in-memory LibraryRepository fake that faithfully implements the
// API-603 contract — one row per manga (device-agnostic), idempotent add, and
// no-op remove — so add/remove/list behaviour is observable across calls within
// a test (mirrors the API-505/601 stateful-fake pattern).
function makeRepo(seed: LibraryEntry[] = []) {
  const rows = new Map<string, LibraryEntry>();
  for (const e of seed) rows.set(e.mangaId, e);

  const list = vi.fn(() => [...rows.values()]);
  const add = vi.fn((entry: LibraryEntry) => {
    // Idempotent: a manga already followed keeps its original row.
    if (!rows.has(entry.mangaId)) rows.set(entry.mangaId, entry);
  });
  const remove = vi.fn((mangaId: string) => {
    rows.delete(mangaId);
  });

  const repo: LibraryRepository = { list, add, remove };
  return { repo, list, add, remove, rows };
}

// API-912 enriches list() with a continue target computed from progress + the
// STORED chapter list. These endpoints don't exercise that computation (see
// library-continue.test.ts), so wire empty stored chapters and no progress: every
// entry gets the neutral `{ nextChapter: null, caughtUp: false }`.
const UNENRICHED = { nextChapter: null, caughtUp: false } as const;

function stubProgressRepository(): ReadingProgressRepository {
  return { get: () => undefined, save: () => undefined };
}

function buildDeps(seed: LibraryEntry[] = []) {
  const { repo, list, add, remove, rows } = makeRepo(seed);
  return {
    deps: {
      suwayomi: { ...stubSuwayomi(), listChapters: async () => [] },
      libraryRepository: repo,
      readingProgressRepository: stubProgressRepository(),
    },
    list,
    add,
    remove,
    rows,
  };
}

describe("GET /api/library", () => {
  it("returns the empty library as { data: [] }", async () => {
    const d = buildDeps();

    const res = await request(createApp(d.deps)).get("/api/library");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
    expect(d.list).toHaveBeenCalled();
  });

  it("lists the followed manga, each carrying its display title (API-907)", async () => {
    const seed: LibraryEntry[] = [
      { mangaId: "1", addedAt: 1000, title: "One Piece" },
      { mangaId: "2", addedAt: 2000, title: "Naruto" },
    ];
    const d = buildDeps(seed);

    const res = await request(createApp(d.deps)).get("/api/library");

    expect(res.status).toBe(200);
    // The { data } envelope carries the title alongside mangaId/addedAt.
    expect(res.body).toEqual({
      data: seed.map((e) => ({ ...e, ...UNENRICHED })),
    });
  });
});

describe("PUT /api/library/:mangaId", () => {
  it("follows a manga, capturing its title at follow time (API-907)", async () => {
    const d = buildDeps();

    const res = await request(createApp(d.deps))
      .put(`/api/library/${MANGA_ID}`)
      .send({ addedAt: 1000, title: TITLE });

    expect(res.status).toBe(200);
    expect(d.add).toHaveBeenCalledTimes(1);
    // The route reads the display title from the body and persists it on the row.
    expect(d.add).toHaveBeenCalledWith({
      mangaId: MANGA_ID,
      addedAt: 1000,
      title: TITLE,
    });
    expect(res.body).toEqual({
      data: { mangaId: MANGA_ID, addedAt: 1000, title: TITLE },
    });
  });

  it("then GET lists the followed manga with its title (API-907)", async () => {
    const d = buildDeps();
    const app = createApp(d.deps);

    await request(app)
      .put(`/api/library/${MANGA_ID}`)
      .send({ addedAt: 1000, title: TITLE });

    const res = await request(app).get("/api/library");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [{ mangaId: MANGA_ID, addedAt: 1000, title: TITLE, ...UNENRICHED }],
    });
  });

  it("allows a follow without a title (graceful — old/title-less clients)", async () => {
    const d = buildDeps();

    const res = await request(createApp(d.deps))
      .put(`/api/library/${MANGA_ID}`)
      .send({ addedAt: 1000 });

    // Title is optional: a title-less follow still succeeds (no 400) and reaches
    // the port — it just carries no title.
    expect(res.status).toBe(200);
    expect(d.add).toHaveBeenCalledWith({ mangaId: MANGA_ID, addedAt: 1000 });
  });

  it("is idempotent: re-following a manga does not create a duplicate", async () => {
    const d = buildDeps();
    const app = createApp(d.deps);

    await request(app)
      .put(`/api/library/${MANGA_ID}`)
      .send({ addedAt: 1000, title: TITLE });
    await request(app)
      .put(`/api/library/${MANGA_ID}`)
      .send({ addedAt: 2000, title: "Renamed" });

    const res = await request(app).get("/api/library");

    expect(res.body).toEqual({
      data: [{ mangaId: MANGA_ID, addedAt: 1000, title: TITLE, ...UNENRICHED }],
    });
  });

  it("is device-agnostic: a device identifier in the body is ignored, never persisted", async () => {
    const d = buildDeps();

    const res = await request(createApp(d.deps))
      .put(`/api/library/${MANGA_ID}`)
      .send({ addedAt: 1000, title: TITLE, deviceId: "kobo-clara" });

    expect(res.status).toBe(200);
    const saved = d.add.mock.calls[0][0];
    // Exactly our three fields — mangaId (URL), addedAt + title (body); no deviceId.
    expect(Object.keys(saved).sort()).toEqual(["addedAt", "mangaId", "title"]);
    expect(res.body.data).not.toHaveProperty("deviceId");
  });

  it("rejects a missing addedAt at the edge (400)", async () => {
    const d = buildDeps();

    const res = await request(createApp(d.deps))
      .put(`/api/library/${MANGA_ID}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "BAD_REQUEST", message: expect.any(String) },
    });
    expect(d.add).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric addedAt at the edge (400)", async () => {
    const d = buildDeps();

    const res = await request(createApp(d.deps))
      .put(`/api/library/${MANGA_ID}`)
      .send({ addedAt: "yesterday" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "BAD_REQUEST", message: expect.any(String) },
    });
    expect(d.add).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/library/:mangaId", () => {
  it("unfollows a manga, removing it from the library", async () => {
    const d = buildDeps([{ mangaId: MANGA_ID, addedAt: 1000 }]);
    const app = createApp(d.deps);

    const res = await request(app).delete(`/api/library/${MANGA_ID}`);

    expect(res.status).toBe(200);
    expect(d.remove).toHaveBeenCalledWith(MANGA_ID);
    expect(res.body).toEqual({ data: { mangaId: MANGA_ID } });

    const list = await request(app).get("/api/library");
    expect(list.body).toEqual({ data: [] });
  });

  it("is a no-op for a manga that is not followed", async () => {
    const d = buildDeps();

    const res = await request(createApp(d.deps)).delete("/api/library/999");

    // Reaching the port keeps this red until the route exists — the generic 404
    // fallback never calls remove.
    expect(d.remove).toHaveBeenCalledWith("999");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { mangaId: "999" } });
  });
});

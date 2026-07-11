import { describe, expect, it, vi } from "vitest";
import { request } from "../support/http.js";
import { createApp } from "../../src/http/app.js";
import type {
  LibraryEntry,
  LibraryRepository,
} from "../../src/services/ports/library-repository.js";
import type { ReadingProgressRepository } from "../../src/services/ports/reading-progress-repository.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

// The library / follows endpoints: GET /api/library lists, PUT
// /api/library/:mangaId follows (idempotent, capturing `title`), DELETE
// unfollows (no-op if absent). `addedAt` comes from the PUT body; the library is
// device-agnostic (keyed by manga only) and stores no Suwayomi metadata.

const MANGA_ID = "42";
const TITLE = "One Piece";

// Stateful so add/remove/list behaviour is observable across calls within a test.
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

// With no stored chapters and no progress, every entry gets this neutral
// continue target (the computation itself is covered by library-continue.test.ts).
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

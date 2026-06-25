import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { NotFoundError } from "../../src/http/errors.js";
import {
  SuwayomiError,
  type Chapter,
  type MangaDetails,
  type SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";

// Contract test for `GET /api/manga/:id` (API-305). The endpoint is exercised
// through Express with the Suwayomi client mocked at the port boundary
// (CLAUDE.md §4): it combines the manga details and the chapter list into one
// response, presents the chapters in reading order, and carries the
// reading-direction metadata the API owns (RFC §6 — "Reading direction
// metadata comes from the API"). The route is implemented in API-306 — these
// assertions stay red until then.

// A SuwayomiClient stub whose details/chapter lookups are controllable; every
// other method rejects so the test fails loudly if the route reaches past the
// ports it needs.
function clientReturning(options: {
  details?: MangaDetails;
  detailsError?: unknown;
  chapters?: readonly Chapter[];
}): {
  suwayomi: SuwayomiClient;
  getMangaDetails: ReturnType<typeof vi.fn>;
  listChapters: ReturnType<typeof vi.fn>;
} {
  const getMangaDetails = vi.fn(async (_id: string) => {
    if (options.detailsError !== undefined) {
      throw options.detailsError;
    }
    return options.details as MangaDetails;
  });
  const listChapters = vi.fn(async (_id: string) => options.chapters ?? []);
  const unexpected = vi.fn(async () => {
    throw new Error("unexpected Suwayomi call");
  });
  const suwayomi: SuwayomiClient = {
    listSources: unexpected,
    search: unexpected,
    getMangaDetails,
    listChapters,
    getChapterPageCount: unexpected,
    fetchPage: unexpected,
  };
  return { suwayomi, getMangaDetails, listChapters };
}

const sampleDetails: MangaDetails = {
  id: "42",
  sourceId: "1",
  title: "Berserk",
  author: "Kentaro Miura",
  artist: "Kentaro Miura",
  description: "A dark fantasy epic.",
  thumbnailUrl: "/thumb/42",
  status: "ONGOING",
  genres: ["Action", "Drama", "Horror"],
};

// Deliberately out of order so the endpoint must impose chapter ordering.
const unorderedChapters: readonly Chapter[] = [
  { id: "103", name: "Chapter 3", chapterNumber: 3, pageCount: 20 },
  { id: "101", name: "Chapter 1", chapterNumber: 1, pageCount: 18 },
  { id: "102", name: "Chapter 2", chapterNumber: 2, pageCount: 22 },
];

describe("GET /api/manga/:id", () => {
  it("returns the manga details with an ordered chapter list", async () => {
    const { suwayomi, getMangaDetails, listChapters } = clientReturning({
      details: sampleDetails,
      chapters: unorderedChapters,
    });

    const res = await request(createApp({ suwayomi })).get("/api/manga/42");

    expect(res.status).toBe(200);
    expect(getMangaDetails).toHaveBeenCalledWith("42");
    expect(listChapters).toHaveBeenCalledWith("42");

    expect(res.body.data).toEqual(
      expect.objectContaining({ manga: sampleDetails }),
    );
    // Chapters are presented in ascending chapter-number order regardless of
    // the order the upstream returned them in.
    expect(res.body.data.chapters.map((c: Chapter) => c.chapterNumber)).toEqual([
      1, 2, 3,
    ]);
    expect(res.body.data.chapters).toEqual([
      { id: "101", name: "Chapter 1", chapterNumber: 1, pageCount: 18 },
      { id: "102", name: "Chapter 2", chapterNumber: 2, pageCount: 22 },
      { id: "103", name: "Chapter 3", chapterNumber: 3, pageCount: 20 },
    ]);
  });

  it("includes the reading-direction metadata in the response", async () => {
    const { suwayomi } = clientReturning({
      details: sampleDetails,
      chapters: unorderedChapters,
    });

    const res = await request(createApp({ suwayomi })).get("/api/manga/42");

    expect(res.status).toBe(200);
    // The API owns reading direction; manga defaults to right-to-left.
    expect(res.body.data).toHaveProperty("readingDirection");
    expect(res.body.data.readingDirection).toBe("rtl");
  });

  it("returns 200 with an empty chapter list when the manga has no chapters", async () => {
    const { suwayomi } = clientReturning({
      details: sampleDetails,
      chapters: [],
    });

    const res = await request(createApp({ suwayomi })).get("/api/manga/42");

    expect(res.status).toBe(200);
    expect(res.body.data.manga).toEqual(sampleDetails);
    expect(res.body.data.chapters).toEqual([]);
  });

  it("returns the 404 error envelope when the manga id is unknown", async () => {
    const { suwayomi, getMangaDetails } = clientReturning({
      detailsError: new NotFoundError("Manga not found"),
    });

    const res = await request(createApp({ suwayomi })).get("/api/manga/999");

    // Asserting the port was reached keeps this red until the route exists —
    // the generic 404 fallback never touches the Suwayomi client.
    expect(getMangaDetails).toHaveBeenCalledWith("999");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: expect.any(String) },
    });
  });

  it("propagates an upstream failure as the 502 error envelope", async () => {
    const { suwayomi } = clientReturning({
      detailsError: new SuwayomiError(),
    });

    const res = await request(createApp({ suwayomi })).get("/api/manga/42");

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      error: { code: "SUWAYOMI_ERROR", message: expect.any(String) },
    });
  });
});

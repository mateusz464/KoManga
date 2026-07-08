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

// GET /api/manga/:id combines details + chapters (ordered ascending) and carries
// the API-owned reading direction. It must trigger the source scrape
// (fetchChapters) rather than read Suwayomi's stored list, so a freshly-searched
// manga returns chapters on first open.

function clientReturning(options: {
  details?: MangaDetails;
  detailsError?: unknown;
  // Chapters the *source* returns when its chapter-fetch is triggered.
  chapters?: readonly Chapter[];
  // What the read-only stored-chapter lookup returns. Empty by default: a
  // freshly-searched manga has nothing stored until the source is scraped.
  storedChapters?: readonly Chapter[];
}): {
  suwayomi: SuwayomiClient;
  getMangaDetails: ReturnType<typeof vi.fn>;
  listChapters: ReturnType<typeof vi.fn>;
  fetchChapters: ReturnType<typeof vi.fn>;
} {
  const getMangaDetails = vi.fn(async (_id: string) => {
    if (options.detailsError !== undefined) {
      throw options.detailsError;
    }
    return options.details as MangaDetails;
  });
  const listChapters = vi.fn(async (_id: string) => [
    ...(options.storedChapters ?? []),
  ]);
  const fetchChapters = vi.fn(async (_id: string) => [
    ...(options.chapters ?? []),
  ]);
  const unexpected = vi.fn(async () => {
    throw new Error("unexpected Suwayomi call");
  });
  const suwayomi: SuwayomiClient = {
    listSources: unexpected,
    search: unexpected,
    getMangaDetails,
    listChapters,
    getChapterDetails: unexpected,
    fetchChapters,
    getChapterPageCount: unexpected,
    fetchPageUrls: unexpected,
    fetchPageBytes: unexpected,
    fetchPage: unexpected,
    fetchCover: unexpected,
  };
  return { suwayomi, getMangaDetails, listChapters, fetchChapters };
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
  it("triggers the source chapter-fetch and returns the fetched chapters, ordered", async () => {
    // Nothing stored yet (the freshly-searched case); the source returns the
    // chapters only when its fetch is triggered.
    const { suwayomi, getMangaDetails, fetchChapters } = clientReturning({
      details: sampleDetails,
      chapters: unorderedChapters,
      storedChapters: [],
    });

    const res = await request(createApp({ suwayomi })).get("/api/manga/42");

    expect(res.status).toBe(200);
    expect(getMangaDetails).toHaveBeenCalledWith("42");
    // The endpoint must trigger the source chapter-fetch rather than rely on
    // the empty stored list — this is the regression API-903 pins.
    expect(fetchChapters).toHaveBeenCalledWith("42");

    expect(res.body.data).toEqual(
      expect.objectContaining({ manga: sampleDetails }),
    );
    // Fetched chapters are presented in ascending chapter-number order
    // regardless of the order the source returned them in.
    expect(res.body.data.chapters.map((c: Chapter) => c.chapterNumber)).toEqual(
      [1, 2, 3],
    );
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
    // The response keeps the existing `{ manga, chapters, readingDirection }`
    // shape; the API owns reading direction; manga defaults to right-to-left.
    expect(res.body.data).toHaveProperty("readingDirection");
    expect(res.body.data.readingDirection).toBe("rtl");
  });

  it("returns 200 with an empty chapter list when the source genuinely has none", async () => {
    // Suwayomi answers "No chapters found"; the adapter maps that to an empty
    // list, so the source fetch resolves to `[]` — that must surface as a 200
    // with `chapters: []`, never a 5xx.
    const { suwayomi, fetchChapters } = clientReturning({
      details: sampleDetails,
      chapters: [],
      storedChapters: [],
    });

    const res = await request(createApp({ suwayomi })).get("/api/manga/42");

    expect(res.status).toBe(200);
    expect(fetchChapters).toHaveBeenCalledWith("42");
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

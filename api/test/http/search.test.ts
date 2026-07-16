import { describe, expect, it, vi } from "vitest";
import { request } from "../support/http.js";
import { createApp } from "../../src/http/app.js";
import {
  SuwayomiError,
  type SearchParams,
  type SearchResult,
  type SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";

// GET /api/search?q=&source= validates the query string, forwards q/source (+
// optional page) to search(), and shapes the result into the success envelope.

function clientSearching(result: SearchResult): {
  suwayomi: SuwayomiClient;
  search: ReturnType<typeof vi.fn>;
} {
  const search = vi.fn(async (_params: SearchParams) => result);
  const unexpected = vi.fn(async () => {
    throw new Error("unexpected Suwayomi call");
  });
  const suwayomi: SuwayomiClient = {
    listSources: unexpected,
    search,
    getMangaDetails: unexpected,
    listChapters: unexpected,
    getChapterDetails: unexpected,
    fetchChapters: unexpected,
    getChapterPageCount: unexpected,
    fetchPageUrls: unexpected,
    fetchPageBytes: unexpected,
    fetchPage: unexpected,
    fetchCover: unexpected,
  };
  return { suwayomi, search };
}

function clientFailing(error: unknown): SuwayomiClient {
  const unexpected = vi.fn(async () => {
    throw new Error("unexpected Suwayomi call");
  });
  return {
    listSources: unexpected,
    search: vi.fn(async () => {
      throw error;
    }),
    getMangaDetails: unexpected,
    listChapters: unexpected,
    getChapterDetails: unexpected,
    fetchChapters: unexpected,
    getChapterPageCount: unexpected,
    fetchPageUrls: unexpected,
    fetchPageBytes: unexpected,
    fetchPage: unexpected,
    fetchCover: unexpected,
  };
}

const sampleResult: SearchResult = {
  mangas: [
    { id: "10", title: "Berserk", thumbnailUrl: "/thumb/10" },
    { id: "11", title: "Vinland Saga" },
  ],
  hasNextPage: true,
};

describe("GET /api/search", () => {
  it("forwards q and source to the client and maps the result into the success envelope", async () => {
    const { suwayomi, search } = clientSearching(sampleResult);

    const res = await request(createApp({ suwayomi })).get(
      "/api/search?q=berserk&source=1",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: sampleResult });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "1", query: "berserk" }),
    );
  });

  it("forwards the pagination param as a number", async () => {
    const { suwayomi, search } = clientSearching(sampleResult);

    const res = await request(createApp({ suwayomi })).get(
      "/api/search?q=berserk&source=1&page=2",
    );

    expect(res.status).toBe(200);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "1", query: "berserk", page: 2 }),
    );
  });

  it("forwards repeated opaque genre tokens and permits genre-only browsing", async () => {
    const { suwayomi, search } = clientSearching(sampleResult);

    const res = await request(createApp({ suwayomi })).get(
      "/api/search?source=1&genre=opaque-action&genre=opaque-drama",
    );

    expect(res.status).toBe(200);
    expect(search).toHaveBeenCalledWith({
      sourceId: "1",
      query: "",
      genres: ["opaque-action", "opaque-drama"],
    });
  });

  it("returns 200 with an empty result set when the source has no matches", async () => {
    const emptyResult: SearchResult = { mangas: [], hasNextPage: false };
    const { suwayomi } = clientSearching(emptyResult);

    const res = await request(createApp({ suwayomi })).get(
      "/api/search?q=nothingmatches&source=1",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: emptyResult });
  });

  it("returns 400 when q is missing", async () => {
    const { suwayomi, search } = clientSearching(sampleResult);

    const res = await request(createApp({ suwayomi })).get(
      "/api/search?source=1",
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "BAD_REQUEST", message: expect.any(String) },
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("returns 400 when source is missing", async () => {
    const { suwayomi, search } = clientSearching(sampleResult);

    const res = await request(createApp({ suwayomi })).get(
      "/api/search?q=berserk",
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "BAD_REQUEST", message: expect.any(String) },
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("propagates an upstream failure as the 502 error envelope", async () => {
    const suwayomi = clientFailing(new SuwayomiError());

    const res = await request(createApp({ suwayomi })).get(
      "/api/search?q=berserk&source=1",
    );

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      error: { code: "SUWAYOMI_ERROR", message: expect.any(String) },
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import {
  SuwayomiError,
  type SearchParams,
  type SearchResult,
  type SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";

// Contract test for `GET /api/search?q=&source=` (API-303). The endpoint is
// exercised through Express with the Suwayomi client mocked at the port boundary
// (CLAUDE.md §4): the route must validate the query string, forward `q`/`source`
// (and optional pagination) to `search()`, and shape the result into the
// standard success envelope. The route is implemented in API-304 — these
// assertions stay red until then.

// A SuwayomiClient stub whose `search` is controllable; every other method
// rejects so the test fails loudly if the route reaches past the port it needs.
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
    getChapterPageCount: unexpected,
    fetchPage: unexpected,
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
    getChapterPageCount: unexpected,
    fetchPage: unexpected,
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

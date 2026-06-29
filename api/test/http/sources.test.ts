import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import {
  SuwayomiError,
  type Source,
  type SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";

// Contract test for `GET /api/sources` (API-301). The endpoint is exercised
// through Express with the Suwayomi client mocked at the port boundary
// (CLAUDE.md §4): the route must delegate to `listSources()` and shape the
// result into the standard success envelope. The route is implemented in
// API-302 — these assertions stay red until then.

// A SuwayomiClient stub whose `listSources` is controllable; every other method
// rejects so the test fails loudly if the route reaches past the port it needs.
function clientListing(sources: Source[]): {
  suwayomi: SuwayomiClient;
  listSources: ReturnType<typeof vi.fn>;
} {
  const listSources = vi.fn(async () => sources);
  const unexpected = vi.fn(async () => {
    throw new Error("unexpected Suwayomi call");
  });
  const suwayomi: SuwayomiClient = {
    listSources,
    search: unexpected,
    getMangaDetails: unexpected,
    listChapters: unexpected,
    fetchChapters: unexpected,
    getChapterPageCount: unexpected,
    fetchPage: unexpected,
    fetchCover: unexpected,
  };
  return { suwayomi, listSources };
}

function clientFailing(error: unknown): SuwayomiClient {
  const unexpected = vi.fn(async () => {
    throw new Error("unexpected Suwayomi call");
  });
  return {
    listSources: vi.fn(async () => {
      throw error;
    }),
    search: unexpected,
    getMangaDetails: unexpected,
    listChapters: unexpected,
    fetchChapters: unexpected,
    getChapterPageCount: unexpected,
    fetchPage: unexpected,
    fetchCover: unexpected,
  };
}

describe("GET /api/sources", () => {
  it("returns 200 and maps the client output into the success envelope", async () => {
    const sources: Source[] = [
      { id: "1", name: "MangaDex", lang: "en", iconUrl: "/icon/1" },
      { id: "2", name: "Comick", lang: "en" },
    ];
    const { suwayomi, listSources } = clientListing(sources);

    const res = await request(createApp({ suwayomi })).get("/api/sources");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: sources });
    expect(listSources).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with an empty array when no sources are installed", async () => {
    const { suwayomi } = clientListing([]);

    const res = await request(createApp({ suwayomi })).get("/api/sources");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });

  it("propagates an upstream failure as the 502 error envelope", async () => {
    const suwayomi = clientFailing(new SuwayomiError());

    const res = await request(createApp({ suwayomi })).get("/api/sources");

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      error: { code: "SUWAYOMI_ERROR", message: expect.any(String) },
    });
  });
});

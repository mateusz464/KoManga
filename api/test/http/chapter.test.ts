import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { NotFoundError } from "../../src/http/errors.js";
import {
  SuwayomiError,
  type SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";

// GET /api/chapter/:id/pages returns page metadata only — the page count plus a
// page id per page — never any image bytes.

function clientWithPageCount(options: {
  pageCount?: number;
  error?: unknown;
}): {
  suwayomi: SuwayomiClient;
  getChapterPageCount: ReturnType<typeof vi.fn>;
} {
  const getChapterPageCount = vi.fn(async (_chapterId: string) => {
    if (options.error !== undefined) {
      throw options.error;
    }
    return options.pageCount as number;
  });
  const unexpected = vi.fn(async () => {
    throw new Error("unexpected Suwayomi call");
  });
  const suwayomi: SuwayomiClient = {
    listSources: unexpected,
    search: unexpected,
    getMangaDetails: unexpected,
    listChapters: unexpected,
    fetchChapters: unexpected,
    getChapterPageCount,
    fetchPageUrls: unexpected,
    fetchPageBytes: unexpected,
    fetchPage: unexpected,
    fetchCover: unexpected,
  };
  return { suwayomi, getChapterPageCount };
}

describe("GET /api/chapter/:id/pages", () => {
  it("returns the page count and one page id per page", async () => {
    const { suwayomi, getChapterPageCount } = clientWithPageCount({
      pageCount: 3,
    });

    const res = await request(createApp({ suwayomi })).get(
      "/api/chapter/77/pages",
    );

    expect(res.status).toBe(200);
    expect(getChapterPageCount).toHaveBeenCalledWith("77");

    expect(res.body.data.pageCount).toBe(3);
    expect(Array.isArray(res.body.data.pages)).toBe(true);
    expect(res.body.data.pages).toHaveLength(3);
  });

  it("identifies each page with a string id derived from the chapter", async () => {
    const { suwayomi } = clientWithPageCount({ pageCount: 3 });

    const res = await request(createApp({ suwayomi })).get(
      "/api/chapter/77/pages",
    );

    expect(res.status).toBe(200);
    // Every page is a plain string id (usable against `GET /api/page/:id`),
    // scoped to its chapter and ordered from the first page.
    const { pages } = res.body.data;
    for (const id of pages) {
      expect(typeof id).toBe("string");
      expect(id).toContain("77");
    }
    expect(new Set(pages).size).toBe(pages.length);
    expect(pages).toEqual(["77:0", "77:1", "77:2"]);
  });

  it("returns metadata only — no image or binary payload", async () => {
    const { suwayomi } = clientWithPageCount({ pageCount: 2 });

    const res = await request(createApp({ suwayomi })).get(
      "/api/chapter/77/pages",
    );

    expect(res.status).toBe(200);
    expect(res.type).toBe("application/json");
    // No page bytes/urls leak through the metadata endpoint.
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toMatch(/bytes|base64|http/i);
    for (const page of res.body.data.pages) {
      expect(typeof page).not.toBe("object");
    }
  });

  it("returns 200 with an empty page list when the chapter has no pages", async () => {
    const { suwayomi } = clientWithPageCount({ pageCount: 0 });

    const res = await request(createApp({ suwayomi })).get(
      "/api/chapter/77/pages",
    );

    expect(res.status).toBe(200);
    expect(res.body.data.pageCount).toBe(0);
    expect(res.body.data.pages).toEqual([]);
  });

  it("returns the 404 error envelope when the chapter id is unknown", async () => {
    const { suwayomi, getChapterPageCount } = clientWithPageCount({
      error: new NotFoundError("Chapter not found"),
    });

    const res = await request(createApp({ suwayomi })).get(
      "/api/chapter/999/pages",
    );

    // Asserting the port was reached keeps this red until the route exists —
    // the generic 404 fallback never touches the Suwayomi client.
    expect(getChapterPageCount).toHaveBeenCalledWith("999");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: expect.any(String) },
    });
  });

  it("propagates an upstream failure as the 502 error envelope", async () => {
    const { suwayomi } = clientWithPageCount({ error: new SuwayomiError() });

    const res = await request(createApp({ suwayomi })).get(
      "/api/chapter/77/pages",
    );

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      error: { code: "SUWAYOMI_ERROR", message: expect.any(String) },
    });
  });
});

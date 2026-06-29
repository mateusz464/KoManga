import { describe, expect, it, vi } from "vitest";
import { SuwayomiGraphQLClient } from "../../../src/adapters/suwayomi/client.js";
import type { GraphQLTransport } from "../../../src/adapters/suwayomi/transport.js";
import { SuwayomiError } from "../../../src/services/ports/suwayomi-client.js";
import { NotFoundError } from "../../../src/http/errors.js";

// Shape of the rejection `graphql-request` throws for a missing manga: Suwayomi
// declares `manga` non-null, so an unknown id surfaces as a GraphQL response
// error (non-null violation on the `manga` path) rather than `manga: null`.
// Confirmed against live Suwayomi v2.2.2100 during API-306 verification.
function mangaNotFoundError(): unknown {
  return {
    response: {
      errors: [
        {
          message:
            "The field at path '/manga' was declared as a non null type, " +
            "but the code involved in retrieving data has wrongly returned a null value.",
          path: ["manga"],
        },
      ],
    },
  };
}

// Shape of the rejection `graphql-request` throws for an unknown chapter id on
// the `fetchChapterPages` mutation: Suwayomi returns `fetchChapterPages: null`
// plus a GraphQL "Collection is empty." error. Confirmed against live Suwayomi
// v2.2.2100 during API-402 verification.
function chapterNotFoundError(): unknown {
  return {
    response: {
      data: { fetchChapterPages: null },
      errors: [{ message: "Collection is empty." }],
    },
  };
}

// Shape of the rejection `graphql-request` throws when a source genuinely has
// no chapters: Suwayomi answers the `fetchChapters` mutation with a "No
// chapters found" GraphQL error. The adapter maps this to an empty list, not a
// 5xx (API-904).
function noChaptersFoundError(): unknown {
  return {
    response: {
      data: { fetchChapters: null },
      errors: [{ message: "No chapters found" }],
    },
  };
}

// Contract test for the Suwayomi client port (API-201). The adapter is
// exercised against a *mocked GraphQL transport* so the mapping and error
// contract are pinned without a live Suwayomi server. The concrete mapping is
// implemented in API-202 — these tests stay red until then.

function transportReturning(data: unknown): {
  transport: GraphQLTransport;
  request: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn(async () => data);
  return { transport: { request }, request };
}

function transportFailing(error: unknown): GraphQLTransport {
  return {
    request: vi.fn(async () => {
      throw error;
    }),
  };
}

describe("SuwayomiGraphQLClient (port contract)", () => {
  describe("success", () => {
    it("listSources maps transport data to domain Source[]", async () => {
      const { transport } = transportReturning({
        sources: {
          nodes: [
            {
              id: "1",
              displayName: "MangaDex",
              lang: "en",
              iconUrl: "/icon/1",
            },
          ],
        },
      });
      const client = new SuwayomiGraphQLClient(transport);

      await expect(client.listSources()).resolves.toEqual([
        { id: "1", name: "MangaDex", lang: "en", iconUrl: "/icon/1" },
      ]);
    });

    it("search forwards source/query/page and maps the result page", async () => {
      const { transport, request } = transportReturning({
        fetchSourceManga: {
          mangas: [{ id: "10", title: "Solo Leveling", thumbnailUrl: "/t/10" }],
          hasNextPage: true,
        },
      });
      const client = new SuwayomiGraphQLClient(transport);

      const result = await client.search({
        sourceId: "1",
        query: "solo",
        page: 2,
      });

      expect(result).toEqual({
        mangas: [{ id: "10", title: "Solo Leveling", thumbnailUrl: "/t/10" }],
        hasNextPage: true,
      });
      // The query, source and page are forwarded to the transport as variables.
      expect(request).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ source: "1", query: "solo", page: 2 }),
      );
    });

    it("getMangaDetails maps details including genres", async () => {
      const { transport } = transportReturning({
        manga: {
          id: "10",
          sourceId: "1",
          title: "Solo Leveling",
          author: "Chugong",
          description: "A weak hunter grows strong.",
          thumbnailUrl: "/t/10",
          status: "ONGOING",
          genres: ["Action", "Fantasy"],
        },
      });
      const client = new SuwayomiGraphQLClient(transport);

      await expect(client.getMangaDetails("10")).resolves.toMatchObject({
        id: "10",
        title: "Solo Leveling",
        genres: ["Action", "Fantasy"],
      });
    });

    it("listChapters maps an ordered chapter list", async () => {
      const { transport } = transportReturning({
        manga: {
          chapters: {
            nodes: [
              { id: "100", name: "Ch. 1", chapterNumber: 1 },
              { id: "101", name: "Ch. 2", chapterNumber: 2 },
            ],
          },
        },
      });
      const client = new SuwayomiGraphQLClient(transport);

      const chapters = await client.listChapters("10");

      expect(chapters.map((c) => c.id)).toEqual(["100", "101"]);
      expect(chapters[0]).toMatchObject({ name: "Ch. 1", chapterNumber: 1 });
    });

    it("fetchChapters scrapes the source and maps the chapter list", async () => {
      const { transport, request } = transportReturning({
        fetchChapters: {
          chapters: [
            { id: "100", name: "Ch. 1", chapterNumber: 1, pageCount: 18 },
            { id: "101", name: "Ch. 2", chapterNumber: 2, pageCount: 20 },
          ],
        },
      });
      const client = new SuwayomiGraphQLClient(transport);

      const chapters = await client.fetchChapters("10");

      expect(chapters.map((c) => c.id)).toEqual(["100", "101"]);
      expect(chapters[0]).toMatchObject({ name: "Ch. 1", chapterNumber: 1 });
      // The manga id is forwarded to the transport coerced to an Int.
      expect(request).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ mangaId: 10 }),
      );
    });

    it("fetchChapters returns an empty list when the payload has no chapters", async () => {
      const { transport } = transportReturning({
        fetchChapters: { chapters: [] },
      });
      const client = new SuwayomiGraphQLClient(transport);

      await expect(client.fetchChapters("10")).resolves.toEqual([]);
    });

    it("getChapterPageCount returns the number of pages, not their data", async () => {
      const { transport, request } = transportReturning({
        fetchChapterPages: {
          pages: ["/p/0.png", "/p/1.png", "/p/2.png"],
        },
      });
      const client = new SuwayomiGraphQLClient(transport);

      await expect(client.getChapterPageCount("100")).resolves.toBe(3);
      // The chapter id is forwarded to the transport coerced to an Int.
      expect(request).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ chapterId: 100 }),
      );
    });

    it("getChapterPageCount is 0 when the chapter has no pages", async () => {
      const { transport } = transportReturning({
        fetchChapterPages: { pages: [] },
      });
      const client = new SuwayomiGraphQLClient(transport);

      await expect(client.getChapterPageCount("100")).resolves.toBe(0);
    });
  });

  describe("GraphQL error", () => {
    it("surfaces a GraphQL error rejection as a typed SuwayomiError", async () => {
      const transport = transportFailing(
        new Error("GraphQL Error: Field 'sources' not found"),
      );
      const client = new SuwayomiGraphQLClient(transport);

      await expect(client.listSources()).rejects.toBeInstanceOf(SuwayomiError);
    });

    it("does not leak the underlying GraphQL message to the caller", async () => {
      const secret = "GraphQL Error: internal schema detail xyz";
      const transport = transportFailing(new Error(secret));
      const client = new SuwayomiGraphQLClient(transport);

      const rejection = client.listSources();
      await expect(rejection).rejects.toBeInstanceOf(SuwayomiError);
      await expect(rejection).rejects.not.toThrow(secret);
    });
  });

  describe("not found", () => {
    it("getMangaDetails maps Suwayomi's missing-manga error to NotFoundError", async () => {
      const transport = transportFailing(mangaNotFoundError());
      const client = new SuwayomiGraphQLClient(transport);

      await expect(client.getMangaDetails("999999")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("getMangaDetails maps a null manga payload to NotFoundError", async () => {
      const { transport } = transportReturning({ manga: null });
      const client = new SuwayomiGraphQLClient(transport);

      await expect(client.getMangaDetails("999999")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("listChapters maps Suwayomi's missing-manga error to NotFoundError", async () => {
      const transport = transportFailing(mangaNotFoundError());
      const client = new SuwayomiGraphQLClient(transport);

      await expect(client.listChapters("999999")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("fetchChapters maps a 'No chapters found' source response to an empty list", async () => {
      const transport = transportFailing(noChaptersFoundError());
      const client = new SuwayomiGraphQLClient(transport);

      // A source that genuinely has no chapters is not an error — it is an
      // empty list (API-904), never a 5xx.
      await expect(client.fetchChapters("10")).resolves.toEqual([]);
    });

    it("fetchChapters maps Suwayomi's missing-manga error to NotFoundError", async () => {
      const transport = transportFailing(mangaNotFoundError());
      const client = new SuwayomiGraphQLClient(transport);

      await expect(client.fetchChapters("999999")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("a non-not-found GraphQL error on fetchChapters stays a SuwayomiError", async () => {
      const transport = transportFailing(
        new Error("GraphQL Error: source temporarily unavailable"),
      );
      const client = new SuwayomiGraphQLClient(transport);

      await expect(client.fetchChapters("10")).rejects.toBeInstanceOf(
        SuwayomiError,
      );
    });

    it("getChapterPageCount maps Suwayomi's empty-collection error to NotFoundError", async () => {
      const transport = transportFailing(chapterNotFoundError());
      const client = new SuwayomiGraphQLClient(transport);

      await expect(client.getChapterPageCount("999999")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("fetchPage maps an unknown chapter to NotFoundError", async () => {
      const transport = transportFailing(chapterNotFoundError());
      const client = new SuwayomiGraphQLClient(transport);

      await expect(
        client.fetchPage({ chapterId: "999999", pageIndex: 0 }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("a non-not-found GraphQL error on a chapter query stays a SuwayomiError", async () => {
      const transport = transportFailing(
        new Error("GraphQL Error: source temporarily unavailable"),
      );
      const client = new SuwayomiGraphQLClient(transport);

      await expect(client.getChapterPageCount("100")).rejects.toBeInstanceOf(
        SuwayomiError,
      );
    });

    it("a non-not-found GraphQL error on a manga query stays a SuwayomiError", async () => {
      const transport = transportFailing(
        new Error("GraphQL Error: timeout talking to source"),
      );
      const client = new SuwayomiGraphQLClient(transport);

      await expect(client.getMangaDetails("10")).rejects.toBeInstanceOf(
        SuwayomiError,
      );
    });
  });

  describe("network failure", () => {
    it("surfaces a transport/network failure as a typed SuwayomiError", async () => {
      const transport = transportFailing(
        Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" }),
      );
      const client = new SuwayomiGraphQLClient(transport);

      await expect(
        client.search({ sourceId: "1", query: "x" }),
      ).rejects.toBeInstanceOf(SuwayomiError);
    });

    it("getChapterPageCount surfaces a transport failure as a SuwayomiError", async () => {
      const transport = transportFailing(
        Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" }),
      );
      const client = new SuwayomiGraphQLClient(transport);

      await expect(client.getChapterPageCount("100")).rejects.toBeInstanceOf(
        SuwayomiError,
      );
    });
  });
});

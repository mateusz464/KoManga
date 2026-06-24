import { describe, expect, it, vi } from "vitest";
import { SuwayomiGraphQLClient } from "../../../src/adapters/suwayomi/client.js";
import type { GraphQLTransport } from "../../../src/adapters/suwayomi/transport.js";
import { SuwayomiError } from "../../../src/services/ports/suwayomi-client.js";

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
  });
});

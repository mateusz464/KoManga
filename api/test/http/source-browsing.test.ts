import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/http/app.js";
import type {
  SearchResult,
  SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";
import { request } from "../support/http.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

interface BrowseParams {
  readonly sourceId: string;
  readonly mode: "popular" | "latest";
  readonly page?: number;
}

interface GenreOption {
  readonly name: string;
  readonly token: string;
}

function browsingClient(
  options: {
    readonly result?: SearchResult;
    readonly supportsLatest?: boolean;
    readonly genres?: readonly GenreOption[];
  } = {},
): {
  suwayomi: SuwayomiClient;
  browse: ReturnType<typeof vi.fn>;
  listSourceGenres: ReturnType<typeof vi.fn>;
} {
  const browse = vi.fn(async (_params: BrowseParams) =>
    Promise.resolve(options.result ?? { mangas: [], hasNextPage: false }),
  );
  const listSourceGenres = vi.fn(async (_sourceId: string) =>
    Promise.resolve(options.genres ?? []),
  );
  const suwayomi = Object.assign(stubSuwayomi(), {
    browse,
    listSourceGenres,
    listSources: vi.fn(async () => [
      {
        id: "1",
        name: "MangaDex",
        lang: "en",
        supportsLatest: options.supportsLatest ?? true,
      },
    ]),
  });
  return { suwayomi, browse, listSourceGenres };
}

describe("GET /api/browse", () => {
  it.each(["popular", "latest"] as const)(
    "returns the search envelope for %s listings",
    async (mode) => {
      const result: SearchResult = {
        mangas: [{ id: "10", title: "Berserk" }],
        hasNextPage: true,
      };
      const { suwayomi, browse } = browsingClient({ result });

      const res = await request(createApp({ suwayomi })).get(
        `/api/browse?source=1&mode=${mode}&page=2`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: result });
      expect(browse).toHaveBeenCalledWith({ sourceId: "1", mode, page: 2 });
    },
  );

  it.each([
    "/api/browse?source=1",
    "/api/browse?source=1&mode=recent",
    "/api/browse?mode=popular",
  ])("returns the standard 400 envelope for invalid input: %s", async (url) => {
    const { suwayomi, browse } = browsingClient();

    const res = await request(createApp({ suwayomi })).get(url);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "BAD_REQUEST", message: expect.any(String) },
    });
    expect(browse).not.toHaveBeenCalled();
  });

  it("rejects latest with a client-displayable 400 when the source does not support it", async () => {
    const { suwayomi, browse } = browsingClient({ supportsLatest: false });

    const res = await request(createApp({ suwayomi })).get(
      "/api/browse?source=1&mode=latest",
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: "BAD_REQUEST",
        message: "Latest listings are not supported by this source",
      },
    });
    expect(browse).not.toHaveBeenCalled();
  });
});

describe("GET /api/source/:id/filters", () => {
  it("returns selectable genre names with opaque tokens", async () => {
    const genres = [
      { name: "Action", token: "opaque-action" },
      { name: "Drama", token: "opaque-drama" },
    ];
    const { suwayomi, listSourceGenres } = browsingClient({ genres });

    const res = await request(createApp({ suwayomi })).get(
      "/api/source/1/filters",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: genres });
    expect(listSourceGenres).toHaveBeenCalledWith("1");
  });

  it("returns an empty list when the source has no usable genre filter", async () => {
    const { suwayomi } = browsingClient({ genres: [] });

    const res = await request(createApp({ suwayomi })).get(
      "/api/source/1/filters",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });
});

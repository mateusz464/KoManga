import { describe, expect, it, vi } from "vitest";
import {
  AniListTracker,
  type AniListTransport,
} from "../../../src/adapters/trackers/anilist.js";
import {
  TrackerError,
  type Tracker,
} from "../../../src/services/ports/tracker.js";

function transportReturning(options: {
  readonly graphql?: unknown;
  readonly token?: unknown;
}): {
  readonly transport: AniListTransport;
  readonly request: ReturnType<typeof vi.fn>;
  readonly postToken: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn(async () => options.graphql);
  const postToken = vi.fn(async () => options.token);
  return { transport: { request, postToken }, request, postToken };
}

function transportFailing(error: unknown): AniListTransport {
  return {
    request: vi.fn(async () => {
      throw error;
    }),
    postToken: vi.fn(async () => {
      throw error;
    }),
  };
}

function tracker(transport: AniListTransport): AniListTracker {
  return new AniListTracker(transport, {
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://komanga.example.test/oauth/anilist/callback",
    accessToken: "access-token",
  });
}

function graphQLError(): unknown {
  return {
    response: {
      errors: [{ message: "Cannot query field internalSchemaDetail" }],
    },
  };
}

describe("Tracker port", () => {
  it("is mockable by services without depending on AniList wire types", async () => {
    const mock: Tracker = {
      exchangeCode: vi.fn(async () => ({
        accessToken: "token",
        tokenType: "Bearer",
      })),
      searchMedia: vi.fn(async () => [
        {
          mediaId: "30002",
          title: "Berserk",
          alternateTitles: ["Berserk: The Prototype"],
        },
      ]),
      getListEntry: vi.fn(async () => ({
        progress: 7,
        status: "reading" as const,
      })),
      saveProgress: vi.fn(async () => ({
        progress: 8,
        status: "reading" as const,
      })),
    };

    await expect(mock.getListEntry("30002")).resolves.toEqual({
      progress: 7,
      status: "reading",
    });
  });
});

describe("AniListTracker (port contract)", () => {
  describe("success", () => {
    it("exchanges an OAuth code for a tracker token", async () => {
      const { transport, postToken } = transportReturning({
        token: {
          access_token: "token-123",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh-123",
        },
      });
      const client = tracker(transport);

      await expect(client.exchangeCode("oauth-code")).resolves.toMatchObject({
        accessToken: "token-123",
        tokenType: "Bearer",
        refreshToken: "refresh-123",
      });
      expect(postToken).toHaveBeenCalledWith({
        grant_type: "authorization_code",
        client_id: "client-id",
        client_secret: "client-secret",
        redirect_uri: "https://komanga.example.test/oauth/anilist/callback",
        code: "oauth-code",
      });
    });

    it("searchMedia maps AniList media into domain candidates", async () => {
      const { transport } = transportReturning({
        graphql: {
          Page: {
            media: [
              {
                id: 30002,
                title: {
                  romaji: "Berserk",
                  english: "Berserk",
                  native: "ベルセルク",
                },
                synonyms: ["Berserk: The Prototype"],
                coverImage: { large: "https://img.example.test/berserk.jpg" },
              },
            ],
          },
        },
      });
      const client = tracker(transport);

      await expect(client.searchMedia("berserk")).resolves.toEqual([
        {
          mediaId: "30002",
          title: "Berserk",
          alternateTitles: ["Berserk", "ベルセルク", "Berserk: The Prototype"],
          coverImageUrl: "https://img.example.test/berserk.jpg",
        },
      ]);
    });

    it("searchMedia restricts AniList search to manga and excludes novels", async () => {
      const { transport, request } = transportReturning({
        graphql: { Page: { media: [] } },
      });
      const client = tracker(transport);

      await client.searchMedia("one piece");

      const [document, variables, accessToken] = request.mock.calls[0] as [
        string,
        Record<string, unknown>,
        string,
      ];
      expect(document).toMatch(/type:\s*MANGA/);
      expect(document).toMatch(/format_not:\s*NOVEL/);
      expect(variables).toEqual({ search: "one piece" });
      expect(accessToken).toBe("access-token");
    });

    it("getListEntry maps AniList list status into the tracker status", async () => {
      const { transport, request } = transportReturning({
        graphql: {
          MediaList: {
            progress: 12,
            status: "CURRENT",
          },
        },
      });
      const client = tracker(transport);

      await expect(client.getListEntry("30002")).resolves.toEqual({
        progress: 12,
        status: "reading",
      });
      expect(request).toHaveBeenCalledWith(
        expect.any(String),
        { mediaId: 30002 },
        "access-token",
      );
    });

    it("getListEntry returns null when AniList has no list row", async () => {
      const { transport } = transportReturning({
        graphql: { MediaList: null },
      });
      const client = tracker(transport);

      await expect(client.getListEntry("30002")).resolves.toBeNull();
    });

    it("saveProgress maps tracker status into AniList status and returns the saved entry", async () => {
      const { transport, request } = transportReturning({
        graphql: {
          SaveMediaListEntry: {
            progress: 42,
            status: "COMPLETED",
          },
        },
      });
      const client = tracker(transport);

      await expect(
        client.saveProgress("30002", 42, "completed"),
      ).resolves.toEqual({
        progress: 42,
        status: "completed",
      });
      expect(request).toHaveBeenCalledWith(
        expect.any(String),
        { mediaId: 30002, progress: 42, status: "COMPLETED" },
        "access-token",
      );
    });
  });

  describe("GraphQL error", () => {
    it("normalises AniList GraphQL errors to TrackerError", async () => {
      const client = tracker(transportFailing(graphQLError()));

      await expect(client.searchMedia("berserk")).rejects.toBeInstanceOf(
        TrackerError,
      );
    });

    it("does not leak AniList GraphQL internals through the typed error message", async () => {
      const client = tracker(transportFailing(graphQLError()));
      const rejection = client.searchMedia("berserk");

      await expect(rejection).rejects.toBeInstanceOf(TrackerError);
      await expect(rejection).rejects.not.toThrow("internalSchemaDetail");
    });
  });

  describe("transport failure", () => {
    it("normalises network failures to TrackerError", async () => {
      const client = tracker(
        transportFailing(
          Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" }),
        ),
      );

      await expect(client.getListEntry("30002")).rejects.toBeInstanceOf(
        TrackerError,
      );
    });
  });

  describe("token exchange failure", () => {
    it("normalises OAuth token failures to TrackerError", async () => {
      const client = tracker(
        transportFailing(new Error("invalid_grant: expired code")),
      );

      await expect(client.exchangeCode("expired-code")).rejects.toBeInstanceOf(
        TrackerError,
      );
    });
  });
});

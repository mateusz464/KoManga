import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import type {
  MangaDetails,
  SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";
import {
  TrackerError,
  type Tracker,
  type TrackerMediaCandidate,
} from "../../src/services/ports/tracker.js";
import type {
  TrackerAccount,
  TrackerAccountRepository,
} from "../../src/services/ports/tracker-account-repository.js";
import type {
  TrackerLink,
  TrackerLinkRepository,
  TrackerMatch,
} from "../../src/services/ports/tracker-link-repository.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

const TOKEN = "single-user-token";
const MANGA_ID = "42";
const MEDIA_ID = "30002";
const NOW_FUTURE = Date.now() + 60_000;

const sampleManga: MangaDetails = {
  id: MANGA_ID,
  sourceId: "1",
  title: "Berserk",
  author: "Kentaro Miura",
  artist: "Kentaro Miura",
  description: "A dark fantasy epic.",
  thumbnailUrl: "https://img.example.test/manga/42.jpg",
  status: "ONGOING",
  genres: ["Action", "Drama", "Horror"],
};

const candidates: TrackerMediaCandidate[] = [
  {
    mediaId: MEDIA_ID,
    title: "Berserk",
    alternateTitles: ["Berserk", "ベルセルク", "Berserk: The Prototype"],
    coverImageUrl: "https://img.example.test/anilist/berserk.jpg",
    year: 1989,
    format: "MANGA",
  },
  {
    mediaId: "30003",
    title: "Berserk: Ougon Jidai-hen",
    alternateTitles: ["Berserk: The Golden Age Arc"],
    year: 2012,
    format: "ONE_SHOT",
  },
];

function bearer(token: string): string {
  return `Bearer ${token}`;
}

function suwayomiReturning(details: MangaDetails = sampleManga): {
  suwayomi: SuwayomiClient;
  getMangaDetails: ReturnType<typeof vi.fn>;
} {
  const getMangaDetails = vi.fn(async () => details);
  return {
    suwayomi: {
      ...stubSuwayomi(),
      getMangaDetails,
    },
    getMangaDetails,
  };
}

function trackerReturning(
  options: {
    readonly media?: readonly TrackerMediaCandidate[];
    readonly searchError?: unknown;
  } = {},
): {
  tracker: Tracker;
  searchMedia: ReturnType<typeof vi.fn>;
  getListEntry: ReturnType<typeof vi.fn>;
} {
  const searchMedia = vi.fn(async () => {
    if (options.searchError !== undefined) {
      throw options.searchError;
    }
    return [...(options.media ?? candidates)];
  });
  const getListEntry = vi.fn(async () => ({
    progress: 24,
    status: "reading" as const,
  }));
  return {
    tracker: {
      exchangeCode: vi.fn(async () => ({
        accessToken: "linked-access-token",
        tokenType: "Bearer",
      })),
      searchMedia,
      getListEntry,
      saveProgress: vi.fn(async () => ({
        progress: 24,
        status: "reading" as const,
      })),
    },
    searchMedia,
    getListEntry,
  };
}

function accountRepository(account?: TrackerAccount): {
  repo: TrackerAccountRepository;
  get: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn(() => account);
  return {
    repo: {
      get,
      upsert: vi.fn(),
    },
    get,
  };
}

function linkedAccount(
  overrides: Partial<TrackerAccount> = {},
): TrackerAccount {
  return {
    service: "anilist",
    accessToken: "linked-access-token",
    tokenType: "Bearer",
    expiresAt: NOW_FUTURE,
    anilistUserId: "12345",
    ...overrides,
  };
}

function linkRepository(seed?: TrackerLink): {
  repo: TrackerLinkRepository;
  get: ReturnType<typeof vi.fn>;
  setMatch: ReturnType<typeof vi.fn>;
  clearMatch: ReturnType<typeof vi.fn>;
  setDoNotTrack: ReturnType<typeof vi.fn>;
} {
  let link = seed;
  const get = vi.fn(() => link);
  const setMatch = vi.fn((match: TrackerMatch) => {
    link = {
      mangaId: match.mangaId,
      service: match.service,
      mediaId: match.mediaId,
      doNotTrack: false,
    };
  });
  const clearMatch = vi.fn((mangaId: string, service: "anilist") => {
    link = { mangaId, service, doNotTrack: link?.doNotTrack ?? false };
  });
  const setDoNotTrack = vi.fn(
    (mangaId: string, service: "anilist", doNotTrack: boolean) => {
      link = { mangaId, service, doNotTrack };
    },
  );
  return {
    repo: {
      get,
      setMatch,
      clearMatch,
      setDoNotTrack,
      updateLastSynced: vi.fn(),
    },
    get,
    setMatch,
    clearMatch,
    setDoNotTrack,
  };
}

function appWithTracker(
  options: {
    readonly suwayomi?: SuwayomiClient;
    readonly tracker?: Tracker;
    readonly accounts?: TrackerAccountRepository;
    readonly links?: TrackerLinkRepository;
  } = {},
) {
  return createApp({
    suwayomi: options.suwayomi ?? suwayomiReturning().suwayomi,
    authToken: TOKEN,
    anilistTracker: options.tracker ?? trackerReturning().tracker,
    trackerAccountRepository:
      options.accounts ?? accountRepository(linkedAccount()).repo,
    trackerLinkRepository: options.links ?? linkRepository().repo,
  });
}

describe("GET /api/tracker/manga/:mangaId/candidates (KOM-141)", () => {
  it("searches AniList with the manga title and maps candidate display metadata", async () => {
    const { suwayomi, getMangaDetails } = suwayomiReturning();
    const { tracker, searchMedia } = trackerReturning();

    const res = await request(appWithTracker({ suwayomi, tracker }))
      .get(`/api/tracker/manga/${MANGA_ID}/candidates`)
      .set("Authorization", bearer(TOKEN));

    expect(getMangaDetails).toHaveBeenCalledWith(MANGA_ID);
    expect(searchMedia).toHaveBeenCalledWith("Berserk");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        mangaId: MANGA_ID,
        candidates,
      },
    });
  });

  it("returns an empty candidate list without changing tracker persistence", async () => {
    const { tracker, searchMedia } = trackerReturning({ media: [] });
    const links = linkRepository();

    const res = await request(appWithTracker({ tracker, links: links.repo }))
      .get(`/api/tracker/manga/${MANGA_ID}/candidates`)
      .set("Authorization", bearer(TOKEN));

    expect(searchMedia).toHaveBeenCalledWith("Berserk");
    expect(links.setMatch).not.toHaveBeenCalled();
    expect(links.setDoNotTrack).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        mangaId: MANGA_ID,
        candidates: [],
      },
    });
  });

  it("propagates AniList search failures through the tracker error envelope", async () => {
    const { tracker } = trackerReturning({
      searchError: new TrackerError("graphql"),
    });

    const res = await request(appWithTracker({ tracker }))
      .get(`/api/tracker/manga/${MANGA_ID}/candidates`)
      .set("Authorization", bearer(TOKEN));

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      error: { code: "TRACKER_ERROR", message: expect.any(String) },
    });
  });
});

describe("Manga tracker match management endpoints (KOM-141)", () => {
  it("sets the confirmed AniList media id through the tracker link repository", async () => {
    const links = linkRepository();

    const res = await request(appWithTracker({ links: links.repo }))
      .put(`/api/tracker/manga/${MANGA_ID}/match`)
      .set("Authorization", bearer(TOKEN))
      .send({ mediaId: MEDIA_ID });

    expect(links.setMatch).toHaveBeenCalledWith({
      mangaId: MANGA_ID,
      service: "anilist",
      mediaId: MEDIA_ID,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { mangaId: MANGA_ID, service: "anilist", mediaId: MEDIA_ID },
    });
  });

  it("rejects a missing media id before touching persistence", async () => {
    const links = linkRepository();

    const res = await request(appWithTracker({ links: links.repo }))
      .put(`/api/tracker/manga/${MANGA_ID}/match`)
      .set("Authorization", bearer(TOKEN))
      .send({});

    expect(links.setMatch).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "BAD_REQUEST", message: expect.any(String) },
    });
  });

  it("clears a confirmed match without deleting the manga's tracker row", async () => {
    const links = linkRepository({
      mangaId: MANGA_ID,
      service: "anilist",
      mediaId: MEDIA_ID,
      lastSyncedChapter: 24,
      doNotTrack: false,
    });

    const res = await request(appWithTracker({ links: links.repo }))
      .delete(`/api/tracker/manga/${MANGA_ID}/match`)
      .set("Authorization", bearer(TOKEN));

    expect(links.clearMatch).toHaveBeenCalledWith(MANGA_ID, "anilist");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { mangaId: MANGA_ID, service: "anilist", mediaId: null },
    });
  });

  it("records a do-not-track dismissal through the tracker link repository", async () => {
    const links = linkRepository();

    const res = await request(appWithTracker({ links: links.repo }))
      .post(`/api/tracker/manga/${MANGA_ID}/do-not-track`)
      .set("Authorization", bearer(TOKEN));

    expect(links.setDoNotTrack).toHaveBeenCalledWith(MANGA_ID, "anilist", true);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { mangaId: MANGA_ID, service: "anilist", doNotTrack: true },
    });
  });
});

describe("GET /api/tracker/manga/:mangaId/status (KOM-141)", () => {
  it("reports a matched manga with its media id, last-synced chapter, and healthy account", async () => {
    const links = linkRepository({
      mangaId: MANGA_ID,
      service: "anilist",
      mediaId: MEDIA_ID,
      lastSyncedChapter: 24,
      doNotTrack: false,
    });
    const accounts = accountRepository(linkedAccount());

    const res = await request(
      appWithTracker({ accounts: accounts.repo, links: links.repo }),
    )
      .get(`/api/tracker/manga/${MANGA_ID}/status`)
      .set("Authorization", bearer(TOKEN));

    expect(accounts.get).toHaveBeenCalledWith("anilist");
    expect(links.get).toHaveBeenCalledWith(MANGA_ID, "anilist");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        mangaId: MANGA_ID,
        service: "anilist",
        state: "matched",
        account: { linked: true, needsRelink: false },
        media: { mediaId: MEDIA_ID },
        lastSyncedChapter: 24,
        doNotTrack: false,
      },
    });
  });

  it("reports an unmatched manga when the account is linked but no media is confirmed", async () => {
    const links = linkRepository();

    const res = await request(appWithTracker({ links: links.repo }))
      .get(`/api/tracker/manga/${MANGA_ID}/status`)
      .set("Authorization", bearer(TOKEN));

    expect(links.get).toHaveBeenCalledWith(MANGA_ID, "anilist");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        mangaId: MANGA_ID,
        service: "anilist",
        state: "unmatched",
        account: { linked: true, needsRelink: false },
        media: null,
        lastSyncedChapter: null,
        doNotTrack: false,
      },
    });
  });

  it("reports a do-not-track dismissal distinctly from an unmatched manga", async () => {
    const links = linkRepository({
      mangaId: MANGA_ID,
      service: "anilist",
      doNotTrack: true,
    });

    const res = await request(appWithTracker({ links: links.repo }))
      .get(`/api/tracker/manga/${MANGA_ID}/status`)
      .set("Authorization", bearer(TOKEN));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        mangaId: MANGA_ID,
        service: "anilist",
        state: "do_not_track",
        account: { linked: true, needsRelink: false },
        media: null,
        lastSyncedChapter: null,
        doNotTrack: true,
      },
    });
  });

  it("reports no-account before prompting the client to match anything", async () => {
    const accounts = accountRepository();
    const links = linkRepository({
      mangaId: MANGA_ID,
      service: "anilist",
      mediaId: MEDIA_ID,
      doNotTrack: false,
    });

    const res = await request(
      appWithTracker({ accounts: accounts.repo, links: links.repo }),
    )
      .get(`/api/tracker/manga/${MANGA_ID}/status`)
      .set("Authorization", bearer(TOKEN));

    expect(accounts.get).toHaveBeenCalledWith("anilist");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        mangaId: MANGA_ID,
        service: "anilist",
        state: "no_account",
        account: { linked: false, needsRelink: true },
        media: null,
        lastSyncedChapter: null,
        doNotTrack: false,
      },
    });
  });

  it("flags an expired linked account as needing re-link", async () => {
    const accounts = accountRepository(linkedAccount({ expiresAt: 1 }));

    const res = await request(appWithTracker({ accounts: accounts.repo }))
      .get(`/api/tracker/manga/${MANGA_ID}/status`)
      .set("Authorization", bearer(TOKEN));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        mangaId: MANGA_ID,
        service: "anilist",
        state: "unmatched",
        account: { linked: true, needsRelink: true },
        media: null,
        lastSyncedChapter: null,
        doNotTrack: false,
      },
    });
  });
});

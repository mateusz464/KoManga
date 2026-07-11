import { describe, expect, it, vi } from "vitest";
import { request } from "../support/http.js";
import { createApp } from "../../src/http/app.js";
import type { Logger } from "../../src/services/ports/logger.js";
import {
  TrackerError,
  type Tracker,
  type TrackerListEntry,
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
import type {
  ChapterDetails,
  SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

const TOKEN = "single-user-token";
const MANGA_ID = "42";
const CHAPTER_ID = "4242";
const MEDIA_ID = "30002";

function bearer(token: string): string {
  return `Bearer ${token}`;
}

function chapterDetails(
  chapterNumber: number,
  overrides: Partial<ChapterDetails> = {},
): ChapterDetails {
  return {
    id: CHAPTER_ID,
    mangaId: MANGA_ID,
    name: `Chapter ${chapterNumber}`,
    chapterNumber,
    pageCount: 21,
    ...overrides,
  };
}

function suwayomiReturning(chapter: ChapterDetails): {
  suwayomi: SuwayomiClient;
  getChapterDetails: ReturnType<typeof vi.fn>;
} {
  const getChapterDetails = vi.fn(async () => chapter);
  return {
    suwayomi: {
      ...stubSuwayomi(),
      getChapterDetails,
    },
    getChapterDetails,
  };
}

function trackerReturning(
  entry: TrackerListEntry | null = { progress: 12, status: "reading" },
  overrides: {
    readonly saveProgress?: Tracker["saveProgress"];
  } = {},
): {
  tracker: Tracker;
  getListEntry: ReturnType<typeof vi.fn>;
  saveProgress: ReturnType<typeof vi.fn>;
} {
  const getListEntry = vi.fn(async () => entry);
  const saveProgress = vi.fn(
    overrides.saveProgress ??
      (async (
        _mediaId: string,
        progress: number,
        status: TrackerListEntry["status"],
      ) => ({
        progress,
        status,
      })),
  );
  return {
    tracker: {
      exchangeCode: vi.fn(async () => ({
        accessToken: "linked-access-token",
        tokenType: "Bearer",
      })),
      searchMedia: vi.fn(async () => []),
      getListEntry,
      saveProgress,
    },
    getListEntry,
    saveProgress,
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
      delete: vi.fn(),
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
    expiresAt: Date.now() + 60_000,
    anilistUserId: "12345",
    username: "matt",
    ...overrides,
  };
}

function linkRepository(seed?: TrackerLink): {
  repo: TrackerLinkRepository;
  get: ReturnType<typeof vi.fn>;
  updateLastSynced: ReturnType<typeof vi.fn>;
} {
  let link = seed;
  const get = vi.fn(() => link);
  const updateLastSynced = vi.fn(
    (mangaId: string, service: "anilist", lastSyncedChapter: number) => {
      link = {
        mangaId,
        service,
        mediaId: link?.mediaId,
        doNotTrack: link?.doNotTrack ?? false,
        lastSyncedChapter,
      };
    },
  );
  return {
    repo: {
      get,
      setMatch: vi.fn((match: TrackerMatch) => {
        link = { ...match, doNotTrack: false };
      }),
      clearMatch: vi.fn(),
      setDoNotTrack: vi.fn(),
      updateLastSynced,
    },
    get,
    updateLastSynced,
  };
}

function matchedLink(overrides: Partial<TrackerLink> = {}): TrackerLink {
  return {
    mangaId: MANGA_ID,
    service: "anilist",
    mediaId: MEDIA_ID,
    doNotTrack: false,
    ...overrides,
  };
}

function logger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function appWithTracker(
  options: {
    readonly suwayomi?: SuwayomiClient;
    readonly tracker?: Tracker;
    readonly accounts?: TrackerAccountRepository;
    readonly links?: TrackerLinkRepository;
    readonly logger?: Logger;
  } = {},
) {
  return createApp({
    suwayomi:
      options.suwayomi ?? suwayomiReturning(chapterDetails(24)).suwayomi,
    authToken: TOKEN,
    anilistTracker: options.tracker ?? trackerReturning().tracker,
    trackerAccountRepository:
      options.accounts ?? accountRepository(linkedAccount()).repo,
    trackerLinkRepository: options.links ?? linkRepository(matchedLink()).repo,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
}

function postComplete(app: ReturnType<typeof createApp>) {
  return request(app)
    .post("/api/tracker/complete")
    .set("Authorization", bearer(TOKEN))
    .send({ chapterId: CHAPTER_ID });
}

describe("POST /api/tracker/complete (KOM-143)", () => {
  it("syncs a finished whole-number chapter forward as CURRENT and records the guard", async () => {
    const { suwayomi, getChapterDetails } = suwayomiReturning(
      chapterDetails(24),
    );
    const tracker = trackerReturning({ progress: 12, status: "reading" });
    const links = linkRepository(matchedLink());

    const res = await postComplete(
      appWithTracker({ suwayomi, tracker: tracker.tracker, links: links.repo }),
    );

    expect(res.status).toBe(202);
    await vi.waitFor(() => {
      expect(getChapterDetails).toHaveBeenCalledWith(CHAPTER_ID);
      expect(links.get).toHaveBeenCalledWith(MANGA_ID, "anilist");
      expect(tracker.getListEntry).toHaveBeenCalledWith(MEDIA_ID);
      expect(tracker.saveProgress).toHaveBeenCalledWith(
        MEDIA_ID,
        24,
        "reading",
      );
      expect(links.updateLastSynced).toHaveBeenCalledWith(
        MANGA_ID,
        "anilist",
        24,
      );
    });
  });

  it("floors decimal chapter numbers so a .5 chapter does not bump AniList progress", async () => {
    const { suwayomi } = suwayomiReturning(chapterDetails(24.5));
    const tracker = trackerReturning({ progress: 24, status: "reading" });
    const links = linkRepository(matchedLink({ lastSyncedChapter: 24 }));

    const res = await postComplete(
      appWithTracker({ suwayomi, tracker: tracker.tracker, links: links.repo }),
    );

    expect(res.status).toBe(202);
    await vi.waitFor(() => {
      expect(tracker.saveProgress).not.toHaveBeenCalled();
      expect(links.updateLastSynced).not.toHaveBeenCalled();
    });
  });

  it("seeds the forward-only guard from AniList's existing progress without regressing it", async () => {
    const { suwayomi } = suwayomiReturning(chapterDetails(24));
    const tracker = trackerReturning({ progress: 30, status: "reading" });
    const links = linkRepository(matchedLink());

    const res = await postComplete(
      appWithTracker({ suwayomi, tracker: tracker.tracker, links: links.repo }),
    );

    expect(res.status).toBe(202);
    await vi.waitFor(() => {
      expect(tracker.getListEntry).toHaveBeenCalledWith(MEDIA_ID);
      expect(tracker.saveProgress).not.toHaveBeenCalled();
      expect(links.updateLastSynced).toHaveBeenCalledWith(
        MANGA_ID,
        "anilist",
        30,
      );
    });
  });

  it("marks AniList progress completed when the chapter reaches AniList's known total", async () => {
    const { suwayomi } = suwayomiReturning(chapterDetails(24));
    const tracker = trackerReturning({
      progress: 23,
      status: "reading",
      totalChapters: 24,
    });
    const links = linkRepository(matchedLink({ lastSyncedChapter: 23 }));

    const res = await postComplete(
      appWithTracker({ suwayomi, tracker: tracker.tracker, links: links.repo }),
    );

    expect(res.status).toBe(202);
    await vi.waitFor(() => {
      expect(tracker.saveProgress).toHaveBeenCalledWith(
        MEDIA_ID,
        24,
        "completed",
      );
      expect(links.updateLastSynced).toHaveBeenCalledWith(
        MANGA_ID,
        "anilist",
        24,
      );
    });
  });

  it.each([
    {
      name: "unmatched",
      account: linkedAccount(),
      link: matchedLink({ mediaId: undefined }),
    },
    {
      name: "do-not-track",
      account: linkedAccount(),
      link: matchedLink({ doNotTrack: true }),
    },
    {
      name: "no account",
      account: undefined,
      link: matchedLink(),
    },
  ])("skips silently when the manga is $name", async ({ account, link }) => {
    const tracker = trackerReturning({ progress: 12, status: "reading" });
    const accounts = accountRepository(account);
    const links = linkRepository(link);

    const res = await postComplete(
      appWithTracker({
        tracker: tracker.tracker,
        accounts: accounts.repo,
        links: links.repo,
      }),
    );

    expect(res.status).toBe(202);
    await vi.waitFor(() => {
      expect(accounts.get).toHaveBeenCalledWith("anilist");
      expect(tracker.getListEntry).not.toHaveBeenCalled();
      expect(tracker.saveProgress).not.toHaveBeenCalled();
      expect(links.updateLastSynced).not.toHaveBeenCalled();
    });
  });

  it("responds before a background AniList write settles and logs the swallowed failure", async () => {
    let rejectSave!: (error: unknown) => void;
    let saveRejected = false;
    const pendingSave = new Promise<TrackerListEntry>((_resolve, reject) => {
      rejectSave = reject;
    });
    const tracker = trackerReturning(
      { progress: 12, status: "reading" },
      { saveProgress: async () => pendingSave },
    );
    const links = linkRepository(matchedLink());
    const log = logger();

    const rejectPendingSave = () => {
      if (!saveRejected) {
        saveRejected = true;
        rejectSave(new TrackerError("graphql"));
      }
    };
    let responseStatus: number | undefined;
    const response = postComplete(
      appWithTracker({
        tracker: tracker.tracker,
        links: links.repo,
        logger: log,
      }),
    ).then((res) => {
      responseStatus = res.status;
      return res;
    });

    try {
      await vi.waitFor(() => {
        expect(tracker.saveProgress).toHaveBeenCalledWith(
          MEDIA_ID,
          24,
          "reading",
        );
      });
      await vi.waitFor(() => expect(responseStatus).toBeDefined());
      expect(responseStatus).toBe(202);

      rejectPendingSave();

      await vi.waitFor(() => {
        expect(log.error).toHaveBeenCalled();
        expect(links.updateLastSynced).not.toHaveBeenCalled();
      });
    } finally {
      rejectPendingSave();
      await response;
    }
  });
});

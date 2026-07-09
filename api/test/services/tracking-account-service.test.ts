import { describe, expect, it, vi } from "vitest";
import { TrackingService } from "../../src/services/tracking-service.js";
import type { Tracker } from "../../src/services/ports/tracker.js";
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

const MANGA_ID = "42";
const CHAPTER_ID = "4242";
const MEDIA_ID = "30002";

function linkedAccount(
  overrides: Partial<TrackerAccount> = {},
): TrackerAccount {
  return {
    service: "anilist",
    accessToken: "secret-access-token",
    tokenType: "Bearer",
    expiresAt: Date.now() + 60_000,
    anilistUserId: "12345",
    username: "AniListUser",
    ...overrides,
  };
}

function accountRepository(account?: TrackerAccount): {
  readonly repo: TrackerAccountRepository;
  readonly get: ReturnType<typeof vi.fn>;
  readonly deleteAccount: ReturnType<typeof vi.fn>;
} {
  let stored = account;
  const get = vi.fn((service: "anilist") =>
    stored?.service === service ? stored : undefined,
  );
  const upsert = vi.fn((next: TrackerAccount) => {
    stored = next;
  });
  const deleteAccount = vi.fn((service: "anilist") => {
    if (stored?.service === service) {
      stored = undefined;
    }
  });

  return {
    repo: { get, upsert, delete: deleteAccount },
    get,
    deleteAccount,
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

function linkRepository(seed?: TrackerLink): {
  readonly repo: TrackerLinkRepository;
  readonly get: ReturnType<typeof vi.fn>;
  readonly stored: () => TrackerLink | undefined;
} {
  let link = seed;
  const get = vi.fn(() => link);
  const repo: TrackerLinkRepository = {
    get,
    setMatch: vi.fn((match: TrackerMatch) => {
      link = { ...match, doNotTrack: false };
    }),
    clearMatch: vi.fn(),
    setDoNotTrack: vi.fn(),
    updateLastSynced: vi.fn(),
  };
  return { repo, get, stored: () => link };
}

function tracker(): {
  readonly tracker: Tracker;
  readonly getListEntry: ReturnType<typeof vi.fn>;
  readonly saveProgress: ReturnType<typeof vi.fn>;
} {
  const getListEntry = vi.fn(async () => ({
    progress: 12,
    status: "reading" as const,
  }));
  const saveProgress = vi.fn(async () => ({
    progress: 24,
    status: "reading" as const,
  }));
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

function suwayomi(): SuwayomiClient {
  const chapter: ChapterDetails = {
    id: CHAPTER_ID,
    mangaId: MANGA_ID,
    name: "Chapter 24",
    chapterNumber: 24,
    pageCount: 21,
  };
  return {
    ...stubSuwayomi(),
    getChapterDetails: vi.fn(async () => chapter),
  };
}

function service(
  options: {
    readonly accounts?: TrackerAccountRepository;
    readonly links?: TrackerLinkRepository;
    readonly tracker?: Tracker;
  } = {},
) {
  return new TrackingService(
    suwayomi(),
    options.tracker ?? tracker().tracker,
    options.accounts ?? accountRepository(linkedAccount()).repo,
    options.links ?? linkRepository().repo,
  );
}

describe("TrackingService account status/unlink (KOM-156)", () => {
  it("maps a missing account to an unlinked account status", () => {
    const accounts = accountRepository();

    expect(service({ accounts: accounts.repo }).accountStatus()).toEqual({
      linked: false,
    });
    expect(accounts.get).toHaveBeenCalledWith("anilist");
  });

  it("maps a stored account to public account status without token material", () => {
    const accounts = accountRepository(linkedAccount());

    expect(service({ accounts: accounts.repo }).accountStatus()).toEqual({
      linked: true,
      account: {
        anilistUserId: "12345",
        username: "AniListUser",
      },
    });
  });

  it("unlinks the stored account while leaving tracker_link rows untouched", () => {
    const accounts = accountRepository(linkedAccount());
    const links = linkRepository(matchedLink({ lastSyncedChapter: 12 }));
    const sut = service({ accounts: accounts.repo, links: links.repo });

    expect(sut.unlinkAccount()).toEqual({ linked: false });

    expect(accounts.deleteAccount).toHaveBeenCalledWith("anilist");
    expect(links.stored()).toEqual(matchedLink({ lastSyncedChapter: 12 }));
  });

  it("skips a completed chapter after unlink instead of failing or syncing", async () => {
    const accounts = accountRepository(linkedAccount());
    const links = linkRepository(matchedLink());
    const trackerPort = tracker();
    const sut = service({
      accounts: accounts.repo,
      links: links.repo,
      tracker: trackerPort.tracker,
    });

    sut.unlinkAccount();
    await sut.completeChapter(CHAPTER_ID);

    expect(links.get).toHaveBeenCalledWith(MANGA_ID, "anilist");
    expect(trackerPort.getListEntry).not.toHaveBeenCalled();
    expect(trackerPort.saveProgress).not.toHaveBeenCalled();
  });
});

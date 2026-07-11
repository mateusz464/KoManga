import { describe, expect, it, vi } from "vitest";
import { request } from "../support/http.js";
import { createApp } from "../../src/http/app.js";
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
import { stubSuwayomi } from "../support/stub-suwayomi.js";

const TOKEN = "single-user-token";

function bearer(token: string): string {
  return `Bearer ${token}`;
}

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

function linkRepository(seed?: TrackerLink): {
  readonly repo: TrackerLinkRepository;
  readonly get: ReturnType<typeof vi.fn>;
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
  return { repo, get };
}

function tracker(): Tracker {
  return {
    exchangeCode: vi.fn(async () => ({
      accessToken: "linked-access-token",
      tokenType: "Bearer",
    })),
    searchMedia: vi.fn(async () => []),
    getListEntry: vi.fn(async () => null),
    saveProgress: vi.fn(async () => ({
      progress: 0,
      status: "planning" as const,
    })),
  };
}

function appWithTracker(
  options: {
    readonly accounts?: TrackerAccountRepository;
    readonly links?: TrackerLinkRepository;
  } = {},
) {
  return createApp({
    suwayomi: stubSuwayomi(),
    authToken: TOKEN,
    anilistTracker: tracker(),
    trackerAccountRepository:
      options.accounts ?? accountRepository(linkedAccount()).repo,
    trackerLinkRepository: options.links ?? linkRepository().repo,
  });
}

describe("AniList linked-account endpoints (KOM-156)", () => {
  it("requires the single-user credential", async () => {
    const app = appWithTracker();

    const status = await request(app).get("/api/tracker/anilist/account");
    const unlink = await request(app).delete("/api/tracker/anilist/account");

    expect(status.status).toBe(401);
    expect(status.body.error.code).toBe("UNAUTHORIZED");
    expect(unlink.status).toBe(401);
    expect(unlink.body.error.code).toBe("UNAUTHORIZED");
  });

  it("reports an unlinked account in the standard response envelope", async () => {
    const accounts = accountRepository();

    const res = await request(appWithTracker({ accounts: accounts.repo }))
      .get("/api/tracker/anilist/account")
      .set("Authorization", bearer(TOKEN));

    expect(accounts.get).toHaveBeenCalledWith("anilist");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { linked: false } });
  });

  it("reports a linked account without serialising token material", async () => {
    const accounts = accountRepository(linkedAccount());

    const res = await request(appWithTracker({ accounts: accounts.repo }))
      .get("/api/tracker/anilist/account")
      .set("Authorization", bearer(TOKEN));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        linked: true,
        account: {
          anilistUserId: "12345",
          username: "AniListUser",
        },
      },
    });
    expect(JSON.stringify(res.body)).not.toContain("secret-access-token");
    expect(JSON.stringify(res.body)).not.toContain("Bearer");
    expect(JSON.stringify(res.body)).not.toContain("expiresAt");
  });

  it("unlinks idempotently using the standard response envelope", async () => {
    const accounts = accountRepository(linkedAccount());
    const app = appWithTracker({ accounts: accounts.repo });

    const first = await request(app)
      .delete("/api/tracker/anilist/account")
      .set("Authorization", bearer(TOKEN));
    const second = await request(app)
      .delete("/api/tracker/anilist/account")
      .set("Authorization", bearer(TOKEN));
    const status = await request(app)
      .get("/api/tracker/anilist/account")
      .set("Authorization", bearer(TOKEN));

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ data: { linked: false } });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ data: { linked: false } });
    expect(status.body).toEqual({ data: { linked: false } });
    expect(accounts.deleteAccount).toHaveBeenCalledTimes(2);
    expect(accounts.deleteAccount).toHaveBeenCalledWith("anilist");
  });
});

import { describe, expect, it, vi } from "vitest";
import request, { type Response } from "supertest";
import type { IncomingMessage } from "node:http";
import { createApp } from "../../src/http/app.js";
import {
  TrackerError,
  type Tracker,
} from "../../src/services/ports/tracker.js";
import type {
  TrackerAccount,
  TrackerAccountRepository,
} from "../../src/services/ports/tracker-account-repository.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

const TOKEN = "single-user-token";
const CLIENT_ID = "anilist-client-id";
const CLIENT_SECRET = "anilist-client-secret";
const REDIRECT_URI =
  "https://komanga.example.test/api/tracker/anilist/callback";
const SESSION_TTL_MS = 60_000;
const TOKEN_EXPIRES_AT = new Date("2026-07-08T13:00:00.000Z");
const LINKED_TOKEN = {
  accessToken: "linked-access-token",
  tokenType: "Bearer",
  expiresAt: TOKEN_EXPIRES_AT,
};

function bearer(token: string): string {
  return `Bearer ${token}`;
}

function pngParser(
  res: Response,
  callback: (err: Error | null, body: Buffer) => void,
): void {
  const stream = res as unknown as IncomingMessage;
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  stream.on("end", () => {
    callback(null, Buffer.concat(chunks));
  });
  stream.on("error", (err: Error) => {
    callback(err, Buffer.alloc(0));
  });
}

function tracker(overrides: Partial<Tracker> = {}) {
  const exchangeCode = vi.fn(async () => LINKED_TOKEN);
  const port: Tracker = {
    exchangeCode,
    searchMedia: vi.fn(async () => []),
    getListEntry: vi.fn(async () => null),
    saveProgress: vi.fn(async () => ({
      progress: 0,
      status: "planning" as const,
    })),
    ...overrides,
  };
  return { tracker: port, exchangeCode };
}

function accountRepository() {
  const accounts = new Map<string, TrackerAccount>();
  const get = vi.fn((service: "anilist") => accounts.get(service));
  const upsert = vi.fn((account: TrackerAccount) => {
    accounts.set(account.service, account);
  });
  const repo: TrackerAccountRepository = { get, upsert };
  return { repo, get, upsert };
}

function appWithTracker(
  options: {
    readonly tracker?: Tracker;
    readonly accounts?: TrackerAccountRepository;
    readonly ttlMs?: number;
  } = {},
) {
  const defaultTracker = tracker();
  const defaultAccounts = accountRepository();
  return {
    app: createApp({
      suwayomi: stubSuwayomi(),
      authToken: TOKEN,
      anilistTracker: options.tracker ?? defaultTracker.tracker,
      trackerAccountRepository: options.accounts ?? defaultAccounts.repo,
      anilistOAuth: {
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT_URI,
      },
      trackerLinkSessionTtlMs: options.ttlMs ?? SESSION_TTL_MS,
    }),
    exchangeCode: defaultTracker.exchangeCode,
    upsert: defaultAccounts.upsert,
  };
}

async function createLinkSession(app: ReturnType<typeof createApp>) {
  const res = await request(app)
    .post("/api/tracker/anilist/link")
    .set("Authorization", bearer(TOKEN));

  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    data: {
      sessionId: expect.any(String),
      qrUrl: expect.any(String),
    },
  });
  return res.body.data as { sessionId: string; qrUrl: string };
}

describe("AniList account-linking endpoints (KOM-139)", () => {
  it("creates a short-lived link session and returns the QR image URL", async () => {
    const { app } = appWithTracker();

    const session = await createLinkSession(app);

    expect(session.sessionId).not.toBe("");
    expect(session.qrUrl).toBe(
      `/api/tracker/anilist/link/${session.sessionId}/qr.png`,
    );
  });

  it("renders a PNG QR code for the AniList authorize URL", async () => {
    const { app } = appWithTracker();
    const session = await createLinkSession(app);

    const res = await request(app)
      .get(session.qrUrl)
      .set("Authorization", bearer(TOKEN))
      .buffer(true)
      .parse(pngParser);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^image\/png\b/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
  });

  it("reports pending before the OAuth callback and linked afterwards", async () => {
    const { app, exchangeCode } = appWithTracker();
    const session = await createLinkSession(app);

    const pending = await request(app)
      .get(`/api/tracker/anilist/link/${session.sessionId}/status`)
      .set("Authorization", bearer(TOKEN));

    expect(pending.status).toBe(200);
    expect(pending.body).toEqual({ data: { status: "pending" } });

    const callback = await request(app)
      .get("/api/tracker/anilist/callback")
      .query({ code: "oauth-code", state: session.sessionId });

    expect(callback.status).toBe(200);
    expect(callback.body).toEqual({ data: { status: "linked" } });
    expect(exchangeCode).toHaveBeenCalledWith("oauth-code");

    const linked = await request(app)
      .get(`/api/tracker/anilist/link/${session.sessionId}/status`)
      .set("Authorization", bearer(TOKEN));

    expect(linked.status).toBe(200);
    expect(linked.body).toEqual({ data: { status: "linked" } });
  });

  it("keeps the OAuth callback public while the other tracker routes stay authenticated", async () => {
    const { app, exchangeCode } = appWithTracker();
    const session = await createLinkSession(app);

    const protectedStatus = await request(app).get(
      `/api/tracker/anilist/link/${session.sessionId}/status`,
    );

    expect(protectedStatus.status).toBe(401);
    expect(protectedStatus.body.error.code).toBe("UNAUTHORIZED");

    const callback = await request(app)
      .get("/api/tracker/anilist/callback")
      .query({ code: "oauth-code", state: session.sessionId });

    expect(callback.status).toBe(200);
    expect(callback.body).toEqual({ data: { status: "linked" } });
    expect(exchangeCode).toHaveBeenCalledTimes(1);
  });

  it("stores the exchanged AniList account token when a state is linked", async () => {
    const { repo, upsert } = accountRepository();
    const { tracker: trackerPort } = tracker();
    const { app } = appWithTracker({ tracker: trackerPort, accounts: repo });
    const session = await createLinkSession(app);

    const callback = await request(app)
      .get("/api/tracker/anilist/callback")
      .query({ code: "oauth-code", state: session.sessionId });

    expect(callback.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith({
      service: "anilist",
      accessToken: LINKED_TOKEN.accessToken,
      tokenType: LINKED_TOKEN.tokenType,
      expiresAt: TOKEN_EXPIRES_AT.getTime(),
      anilistUserId: expect.any(String),
    });
  });

  it("rejects a reused state without exchanging the OAuth code twice", async () => {
    const { app, exchangeCode } = appWithTracker();
    const session = await createLinkSession(app);

    const first = await request(app)
      .get("/api/tracker/anilist/callback")
      .query({ code: "first-code", state: session.sessionId });
    const second = await request(app)
      .get("/api/tracker/anilist/callback")
      .query({ code: "second-code", state: session.sessionId });

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe("BAD_REQUEST");
    expect(exchangeCode).toHaveBeenCalledTimes(1);
    expect(exchangeCode).toHaveBeenCalledWith("first-code");
  });

  it("rejects an unknown state without exchanging or storing a token", async () => {
    const { app, exchangeCode, upsert } = appWithTracker();

    const res = await request(app)
      .get("/api/tracker/anilist/callback")
      .query({ code: "oauth-code", state: "missing-session" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reports expired sessions and rejects expired callback states", async () => {
    const { app, exchangeCode, upsert } = appWithTracker({ ttlMs: 1 });
    const session = await createLinkSession(app);

    await new Promise((resolve) => setTimeout(resolve, 5));

    const status = await request(app)
      .get(`/api/tracker/anilist/link/${session.sessionId}/status`)
      .set("Authorization", bearer(TOKEN));
    const callback = await request(app)
      .get("/api/tracker/anilist/callback")
      .query({ code: "oauth-code", state: session.sessionId });

    expect(status.status).toBe(200);
    expect(status.body).toEqual({ data: { status: "expired" } });
    expect(callback.status).toBe(400);
    expect(callback.body.error.code).toBe("BAD_REQUEST");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns the standard tracker error envelope when token exchange fails", async () => {
    const exchangeCode = vi.fn(async () => {
      throw new TrackerError("token_exchange");
    });
    const { tracker: trackerPort } = tracker({ exchangeCode });
    const { repo, upsert } = accountRepository();
    const { app } = appWithTracker({ tracker: trackerPort, accounts: repo });
    const session = await createLinkSession(app);

    const res = await request(app)
      .get("/api/tracker/anilist/callback")
      .query({ code: "bad-code", state: session.sessionId });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      error: { code: "TRACKER_ERROR", message: expect.any(String) },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("requires the callback query code and state before touching the tracker", async () => {
    const { app, exchangeCode } = appWithTracker();

    const missingCode = await request(app)
      .get("/api/tracker/anilist/callback")
      .query({ state: "session" });
    const missingState = await request(app)
      .get("/api/tracker/anilist/callback")
      .query({ code: "oauth-code" });

    expect(missingCode.status).toBe(400);
    expect(missingState.status).toBe(400);
    expect(exchangeCode).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import type {
  Source,
  SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

// Contract test for per-client rate limiting on /api/* (API-703):
//   - Requests over the limit within a window → 429.
//   - Limit + window are configurable.
//
// The limiter is injected through `createApp` via a `rateLimit` option on
// `AppDependencies` (kept optional so existing call sites stay valid; API-704
// mounts the middleware that reads it). These enforcement assertions stay red —
// no middleware is mounted yet, so every request reaches its handler — until
// API-704 makes them green.
//
// Decisions pinned here (RFC §9, CLAUDE.md §9; §8 leaves shapes to impl):
//   - Over the limit within a window → 429 with the standard envelope
//     `{ error: { code: "RATE_LIMITED", message } }`, rejected at the edge BEFORE
//     the downstream port is touched.
//   - "Per-client": counted per `clientKey(req)`, defaulting to the source IP.
//     A custom `clientKey` lets a test prove isolation deterministically without
//     trust-proxy gymnastics.
//   - `clock` is injectable so window expiry is deterministic (mirrors the
//     session cache's injectable clock).
//   - `/health` is never rate-limited.

const SOURCES: Source[] = [
  { id: "src-1", name: "MangaDex", lang: "en" },
  { id: "src-2", name: "Mangakakalot", lang: "en" },
];

// A controllable SuwayomiClient whose `listSources`/`search` are spies returning
// known data. Reaching either proves a request got PAST the limiter to the
// handler — so a rejected (429) request asserting the spy was NOT called keeps
// the test honest (and red) until the middleware short-circuits at the edge.
function controllableSuwayomi() {
  const base = stubSuwayomi();
  const listSources = vi.fn(async () => SOURCES);
  const search = vi.fn(async () => ({
    mangas: SOURCES.map((s) => ({ id: s.id, title: s.name })),
    hasNextPage: false,
  }));
  const suwayomi: SuwayomiClient = { ...base, listSources, search };
  return { suwayomi, listSources, search };
}

// A controllable time source: window expiry is asserted by advancing `now`
// rather than sleeping, so the tests are deterministic and fast.
function controllableClock(start = 1000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("rate limiting on /api/*", () => {
  it("allows requests up to the limit within a window (all 200)", async () => {
    const { suwayomi } = controllableSuwayomi();
    const clock = controllableClock();
    const app = createApp({
      suwayomi,
      rateLimit: { limit: 3, windowMs: 1000, clock: clock.now },
    });

    for (let i = 0; i < 3; i++) {
      const res = await request(app).get("/api/sources");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: SOURCES });
    }
  });

  it("returns 429 once the limit is exceeded within the window, without reaching the handler", async () => {
    const { suwayomi, listSources } = controllableSuwayomi();
    const clock = controllableClock();
    const app = createApp({
      suwayomi,
      rateLimit: { limit: 3, windowMs: 1000, clock: clock.now },
    });

    // The window never advances, so the 4th request is over the limit.
    for (let i = 0; i < 3; i++) {
      const ok = await request(app).get("/api/sources");
      expect(ok.status).toBe(200);
    }

    const limited = await request(app).get("/api/sources");

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      error: { code: "RATE_LIMITED", message: expect.any(String) },
    });
    // Only the allowed requests reached the handler; the rejected one is
    // short-circuited at the edge before the upstream port is touched.
    expect(listSources).toHaveBeenCalledTimes(3);
  });

  it.each([2, 5])(
    "treats the limit as configurable (%i allowed, then 429)",
    async (limit) => {
      const { suwayomi } = controllableSuwayomi();
      const clock = controllableClock();
      const app = createApp({
        suwayomi,
        rateLimit: { limit, windowMs: 1000, clock: clock.now },
      });

      for (let i = 0; i < limit; i++) {
        const ok = await request(app).get("/api/sources");
        expect(ok.status).toBe(200);
      }

      const limited = await request(app).get("/api/sources");
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe("RATE_LIMITED");
    },
  );

  it("refreshes the allowance after the window elapses", async () => {
    const { suwayomi } = controllableSuwayomi();
    const clock = controllableClock();
    const app = createApp({
      suwayomi,
      rateLimit: { limit: 2, windowMs: 1000, clock: clock.now },
    });

    // Exhaust the allowance within the window.
    expect((await request(app).get("/api/sources")).status).toBe(200);
    expect((await request(app).get("/api/sources")).status).toBe(200);
    expect((await request(app).get("/api/sources")).status).toBe(429);

    // Move past the window — the per-client allowance refreshes.
    clock.advance(1001);

    const after = await request(app).get("/api/sources");
    expect(after.status).toBe(200);
  });

  it("shares one client's allowance across all /api/* routes", async () => {
    const { suwayomi } = controllableSuwayomi();
    const clock = controllableClock();
    const app = createApp({
      suwayomi,
      rateLimit: { limit: 2, windowMs: 1000, clock: clock.now },
    });

    // The limiter wraps /api/*, so a mix of endpoints draws on one allowance.
    expect((await request(app).get("/api/sources")).status).toBe(200);
    expect(
      (await request(app).get("/api/search?q=naruto&source=src-1")).status,
    ).toBe(200);

    const third = await request(app).get("/api/sources");
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
  });

  it("is per-client: one client hitting the limit does not rate-limit another", async () => {
    const { suwayomi } = controllableSuwayomi();
    const clock = controllableClock();
    const app = createApp({
      suwayomi,
      rateLimit: {
        limit: 2,
        windowMs: 1000,
        clock: clock.now,
        // Identify the client by an explicit header so isolation is provable
        // without depending on distinct source IPs over loopback.
        clientKey: (req) => req.get("x-client-id") ?? "anonymous",
      },
    });

    // Client A exhausts its allowance within the window.
    expect(
      (await request(app).get("/api/sources").set("x-client-id", "A")).status,
    ).toBe(200);
    expect(
      (await request(app).get("/api/sources").set("x-client-id", "A")).status,
    ).toBe(200);
    expect(
      (await request(app).get("/api/sources").set("x-client-id", "A")).status,
    ).toBe(429);

    // Client B is unaffected by A's exhausted allowance in the same window.
    const b = await request(app).get("/api/sources").set("x-client-id", "B");
    expect(b.status).toBe(200);
    expect(b.body).toEqual({ data: SOURCES });
  });
});

describe("rate limiting leaves /health unlimited", () => {
  it("never rate-limits /health even past the limit", async () => {
    const clock = controllableClock();
    const app = createApp({
      suwayomi: stubSuwayomi(),
      rateLimit: { limit: 1, windowMs: 1000, clock: clock.now },
    });

    // Well over the limit, but /health is public and unmetered.
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import { request } from "../support/http.js";
import { createApp } from "../../src/http/app.js";
import type {
  Source,
  SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

// Per-client rate limiting on /api/*: over the limit within a window → 429 at the
// edge (before the port is touched); limit/window/clock/clientKey are injectable;
// /health is never limited.

const SOURCES: Source[] = [
  { id: "src-1", name: "MangaDex", lang: "en" },
  { id: "src-2", name: "Mangakakalot", lang: "en" },
];

// The spies prove whether a request reached the handler (past the limiter).
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

// Window expiry is asserted by advancing `now` rather than sleeping.
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

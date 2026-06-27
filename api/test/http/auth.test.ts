import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import type {
  Source,
  SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

// Contract test for the single-user auth middleware (API-701):
//   - Every /api/* route requires a valid credential; missing/invalid → 401.
//   - A valid credential passes through to the handler.
//   - /health stays public (the only unauthenticated route).
//
// The middleware is injected through `createApp` via an `authToken` on
// `AppDependencies` (kept optional so existing call sites stay valid; API-702
// mounts the middleware and reads it). These assertions stay red — the
// middleware is not mounted yet, so requests reach handlers without a credential
// — until API-702 makes them green.
//
// Design decisions pinned here (RFC §9, CLAUDE.md §9; §8 leaves shapes to impl):
//   - Scheme: `Authorization: Bearer <token>`, where the token is the single
//     shared secret from config (Config.auth.token). A bearer token in a header
//     carries NO device identity — any client presenting the secret is accepted,
//     so the scheme is single-user but multi-client and does NOT assume one
//     device (RFC §13).
//   - Missing, malformed, or wrong credential → 401 with the standard
//     `{ error: { code: "UNAUTHORIZED", message } }` envelope, rejected at the
//     edge BEFORE any downstream port is touched.
//   - /health is public and reachable with no credential.

const TOKEN = "s3cr3t-single-user-token";

const SOURCES: Source[] = [
  { id: "src-1", name: "MangaDex", lang: "en" },
  { id: "src-2", name: "Mangakakalot", lang: "en" },
];

// A controllable SuwayomiClient: only the methods the protected routes under
// test call are spies returning known data; everything else throws. Reaching any
// of these proves the request got PAST auth to the handler — so when a request
// without a credential must be rejected, asserting the spy was NOT called keeps
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

function bearer(token: string): string {
  return `Bearer ${token}`;
}

describe("auth middleware on /api/*", () => {
  it("rejects a protected route with no credential (401), without reaching the handler", async () => {
    const { suwayomi, listSources } = controllableSuwayomi();
    const app = createApp({ suwayomi, authToken: TOKEN });

    const res = await request(app).get("/api/sources");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: "UNAUTHORIZED", message: expect.any(String) },
    });
    // Rejected at the edge — the upstream port is never touched.
    expect(listSources).not.toHaveBeenCalled();
  });

  it("rejects a wrong token (401), without reaching the handler", async () => {
    const { suwayomi, listSources } = controllableSuwayomi();
    const app = createApp({ suwayomi, authToken: TOKEN });

    const res = await request(app)
      .get("/api/sources")
      .set("Authorization", bearer("not-the-token"));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: "UNAUTHORIZED", message: expect.any(String) },
    });
    expect(listSources).not.toHaveBeenCalled();
  });

  it("rejects a malformed Authorization header (not a Bearer scheme) → 401", async () => {
    const { suwayomi, listSources } = controllableSuwayomi();
    const app = createApp({ suwayomi, authToken: TOKEN });

    // The right secret, but presented under the wrong scheme — still rejected.
    const res = await request(app)
      .get("/api/sources")
      .set("Authorization", `Basic ${TOKEN}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(listSources).not.toHaveBeenCalled();
  });

  it("rejects a bare token with no scheme → 401", async () => {
    const { suwayomi, listSources } = controllableSuwayomi();
    const app = createApp({ suwayomi, authToken: TOKEN });

    const res = await request(app)
      .get("/api/sources")
      .set("Authorization", TOKEN);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(listSources).not.toHaveBeenCalled();
  });

  it("lets a valid Bearer token through to the handler (200)", async () => {
    const { suwayomi, listSources } = controllableSuwayomi();
    const app = createApp({ suwayomi, authToken: TOKEN });

    const res = await request(app)
      .get("/api/sources")
      .set("Authorization", bearer(TOKEN));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: SOURCES });
    expect(listSources).toHaveBeenCalledTimes(1);
  });

  it("guards every /api/* route, not just one (search is 401 without a credential)", async () => {
    const { suwayomi, search } = controllableSuwayomi();
    const app = createApp({ suwayomi, authToken: TOKEN });

    // Valid query params, so a 401 can only come from auth, not edge validation.
    const res = await request(app).get("/api/search?q=naruto&source=src-1");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(search).not.toHaveBeenCalled();
  });

  it("is multi-client / not device-bound: the same token is accepted with no device identifier present", async () => {
    const { suwayomi } = controllableSuwayomi();
    const app = createApp({ suwayomi, authToken: TOKEN });

    // Two independent requests share only the secret — no device id anywhere —
    // and both pass. The scheme assumes no single device (RFC §13).
    const first = await request(app)
      .get("/api/sources")
      .set("Authorization", bearer(TOKEN));
    const second = await request(app)
      .get("/api/sources")
      .set("Authorization", bearer(TOKEN));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });
});

describe("auth middleware leaves /health public", () => {
  it("serves /health with no credential (200)", async () => {
    const app = createApp({ suwayomi: stubSuwayomi(), authToken: TOKEN });

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

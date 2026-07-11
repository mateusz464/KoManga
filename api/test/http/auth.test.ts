import { describe, expect, it, vi } from "vitest";
import { request } from "../support/http.js";
import { createApp } from "../../src/http/app.js";
import type {
  Source,
  SuwayomiClient,
} from "../../src/services/ports/suwayomi-client.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

// Single-user auth on /api/*: `Authorization: Bearer <token>` against the shared
// secret; missing/malformed/wrong → 401 at the edge. The bearer token carries no
// device identity, so the scheme is single-user but multi-client. /health is
// public.

const TOKEN = "s3cr3t-single-user-token";

const SOURCES: Source[] = [
  { id: "src-1", name: "MangaDex", lang: "en" },
  { id: "src-2", name: "Mangakakalot", lang: "en" },
];

// The spies prove whether a request reached the handler (past auth).
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

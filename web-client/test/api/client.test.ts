import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "../../src/api/client.js";
import {
  ApiClientError,
  NetworkError,
  UnauthorizedError,
} from "../../src/api/errors.js";

// KWC-301 — contract tests for the typed API client.
//
// Per test/README.md, the boundary for THIS module drops one level: instead of
// stubbing the api/ client, we replace the global XMLHttpRequest so we can
// assert the request the client actually shapes (method, hand-built URL +
// query string, auth header, body) and drive the response/error mapping. The
// transport is XHR, not fetch, by the device spike (KWC-102).
//
// These are red-phase: the KWC-301 stub rejects/throws, so they fail until the
// KWC-302 implementation lands.

interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

type Outcome =
  | { kind: "respond"; status: number; body?: unknown; rawText?: string }
  | { kind: "networkError" };

type Responder = (req: CapturedRequest) => Outcome;

// Minimal stand-in for XMLHttpRequest covering the surface a hand-rolled XHR
// client uses. It records the request and fires the response asynchronously
// (as a real XHR would) via both onreadystatechange and onload, so the client
// is free to listen on either.
let lastResponder: Responder;
const sent: CapturedRequest[] = [];

class FakeXhr {
  method = "";
  url = "";
  private readonly _headers: Record<string, string> = {};
  status = 0;
  responseText = "";
  response: unknown = "";
  readyState = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onreadystatechange: (() => void) | null = null;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
    this.readyState = 1;
  }

  setRequestHeader(key: string, value: string): void {
    this._headers[key] = value;
  }

  send(body?: string | null): void {
    const req: CapturedRequest = {
      method: this.method,
      url: this.url,
      headers: { ...this._headers },
      body: body ?? null,
    };
    sent.push(req);

    const outcome = lastResponder(req);
    // Resolve on a microtask so the client's returned promise is pending first.
    void Promise.resolve().then(() => {
      if (outcome.kind === "networkError") {
        this.readyState = 4;
        if (this.onerror) this.onerror();
        return;
      }
      this.status = outcome.status;
      this.responseText =
        outcome.rawText !== undefined
          ? outcome.rawText
          : JSON.stringify(outcome.body);
      this.response = this.responseText;
      this.readyState = 4;
      if (this.onreadystatechange) this.onreadystatechange();
      if (this.onload) this.onload();
    });
  }
}

function setResponder(responder: Responder): void {
  lastResponder = responder;
}

// Convenience: respond 200 with the API's `{ data }` envelope.
function ok(data: unknown): Responder {
  return () => ({ kind: "respond", status: 200, body: { data } });
}

// The API error envelope: `{ error: { code, message } }`.
function errorEnvelope(
  status: number,
  code: string,
  message: string,
): Responder {
  return () => ({
    kind: "respond",
    status,
    body: { error: { code, message } },
  });
}

const ORIGINAL_XHR = globalThis.XMLHttpRequest;

beforeEach(() => {
  sent.length = 0;
  // Default: every request 200s with an empty envelope unless a test overrides.
  setResponder(() => ({ kind: "respond", status: 200, body: { data: null } }));
  (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
});

afterEach(() => {
  (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = ORIGINAL_XHR;
});

function makeClient(token: string | null = "secret-token"): ApiClient {
  return new ApiClient({ getToken: () => token });
}

// Parse the query string of a captured URL without URL/URLSearchParams (which
// the client itself must not use) — split the raw string ourselves.
function queryOf(url: string): Record<string, string> {
  const q = url.indexOf("?");
  if (q === -1) return {};
  const out: Record<string, string> = {};
  for (const pair of url.slice(q + 1).split("&")) {
    const eq = pair.indexOf("=");
    const key = decodeURIComponent(pair.slice(0, eq));
    out[key] = decodeURIComponent(pair.slice(eq + 1));
  }
  return out;
}

function pathOf(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

describe("ApiClient — auth header injection", () => {
  it("attaches Authorization: Bearer <token> to every request", async () => {
    const client = makeClient("abc123");
    setResponder(ok([]));

    await client.listSources();

    expect(sent).toHaveLength(1);
    expect(sent[0].headers.Authorization).toBe("Bearer abc123");
  });

  it("omits the Authorization header when no token is available", async () => {
    const client = makeClient(null);
    setResponder(ok([]));

    await client.listSources();

    expect(sent[0].headers.Authorization).toBeUndefined();
  });

  it("reads the token per request, so a later login is picked up", async () => {
    let token: string | null = null;
    const client = new ApiClient({ getToken: () => token });
    setResponder(ok([]));

    await client.listSources();
    token = "after-login";
    await client.listSources();

    expect(sent[0].headers.Authorization).toBeUndefined();
    expect(sent[1].headers.Authorization).toBe("Bearer after-login");
  });
});

describe("ApiClient — error / non-200 handling", () => {
  it("maps 401 to UnauthorizedError (for the auth flow to catch)", async () => {
    const client = makeClient();
    setResponder(
      errorEnvelope(401, "UNAUTHORIZED", "Missing or invalid credentials"),
    );

    const err = await client.listSources().then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(UnauthorizedError);
    expect((err as ApiClientError).status).toBe(401);
  });

  it("maps a non-2xx to ApiClientError carrying the envelope status + code", async () => {
    const client = makeClient();
    setResponder(
      errorEnvelope(502, "SUWAYOMI_ERROR", "Upstream Suwayomi request failed"),
    );

    const err = await client.listSources().then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(502);
    expect((err as ApiClientError).code).toBe("SUWAYOMI_ERROR");
  });

  it("maps 404 to ApiClientError (e.g. no stored progress yet)", async () => {
    const client = makeClient();
    setResponder(errorEnvelope(404, "NOT_FOUND", "No progress for manga '42'"));

    const err = await client.getProgress("42").then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(404);
    expect((err as ApiClientError).code).toBe("NOT_FOUND");
  });

  it("still rejects with ApiClientError when the error body is unparseable", async () => {
    const client = makeClient();
    setResponder(() => ({
      kind: "respond",
      status: 500,
      rawText: "<html>nope",
    }));

    const err = await client.listSources().then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(500);
  });

  it("maps a transport failure to NetworkError", async () => {
    const client = makeClient();
    setResponder(() => ({ kind: "networkError" }));

    const err = await client.listSources().then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(NetworkError);
    expect((err as ApiClientError).status).toBe(0);
  });
});

describe("ApiClient — sources", () => {
  it("GETs /api/sources and unwraps the data envelope", async () => {
    const client = makeClient();
    const sources = [{ id: "s1", name: "MangaDex", lang: "en" }];
    setResponder(ok(sources));

    const result = await client.listSources();

    expect(sent[0].method).toBe("GET");
    expect(pathOf(sent[0].url)).toBe("/api/sources");
    expect(result).toEqual(sources);
  });
});

describe("ApiClient — search", () => {
  it("builds a hand-rolled, encoded query string (q + source)", async () => {
    const client = makeClient();
    setResponder(ok({ mangas: [], hasNextPage: false }));

    await client.search({ sourceId: "src 1", query: "one piece & co" });

    expect(sent[0].method).toBe("GET");
    expect(pathOf(sent[0].url)).toBe("/api/search");
    // Special characters must be percent-encoded, not passed raw.
    expect(sent[0].url).toContain("q=one%20piece%20%26%20co");
    expect(queryOf(sent[0].url)).toMatchObject({
      q: "one piece & co",
      source: "src 1",
    });
  });

  it("omits page for the first page and includes it when given", async () => {
    const client = makeClient();
    setResponder(ok({ mangas: [], hasNextPage: true }));

    await client.search({ sourceId: "s", query: "x" });
    expect(queryOf(sent[0].url).page).toBeUndefined();

    await client.search({ sourceId: "s", query: "x", page: 3 });
    expect(queryOf(sent[1].url).page).toBe("3");
  });

  it("returns the mapped SearchResult", async () => {
    const client = makeClient();
    const payload = {
      mangas: [{ id: "m1", title: "Berserk", thumbnailUrl: "t.png" }],
      hasNextPage: true,
    };
    setResponder(ok(payload));

    const result = await client.search({ sourceId: "s", query: "berserk" });

    expect(result).toEqual(payload);
  });
});

describe("ApiClient — manga details", () => {
  it("GETs /api/manga/:id with an encoded id and returns the MangaView", async () => {
    const client = makeClient();
    const view = {
      manga: { id: "m/1", sourceId: "s", title: "T", genres: [] },
      chapters: [],
      readingDirection: "rtl",
    };
    setResponder(ok(view));

    const result = await client.getManga("m/1");

    expect(pathOf(sent[0].url)).toBe("/api/manga/m%2F1");
    expect(result).toEqual(view);
  });
});

describe("ApiClient — chapter pages", () => {
  it("GETs /api/chapter/:id/pages and returns the page list", async () => {
    const client = makeClient();
    const pages = { pageCount: 2, pages: ["c1:0", "c1:1"] };
    setResponder(ok(pages));

    const result = await client.getChapterPages("c1");

    expect(pathOf(sent[0].url)).toBe("/api/chapter/c1/pages");
    expect(result).toEqual(pages);
  });
});

describe("ApiClient — page-image URL builder", () => {
  it("always requests profile=eink (never raw)", () => {
    const client = makeClient();

    const url = client.pageImageUrl("c1:5");

    expect(queryOf(url).profile).toBe("eink");
    expect(url).not.toContain("raw");
  });

  it("targets /api/page/:id with the id encoded", () => {
    const client = makeClient();

    const url = client.pageImageUrl("c1:5");

    expect(pathOf(url)).toBe("/api/page/c1%3A5");
  });

  it("honours a configured baseUrl for absolute image src", () => {
    const client = new ApiClient({ baseUrl: "https://host.example" });

    const url = client.pageImageUrl("c1:0");

    expect(url).toBe("https://host.example/api/page/c1%3A0?profile=eink");
  });
});

describe("ApiClient — downloads", () => {
  it("POSTs /api/chapter/:id/download with mangaId + profile=eink", async () => {
    const client = makeClient();
    const record = {
      chapterId: "c1",
      mangaId: "m1",
      cbzPath: "/d/c1.cbz",
      status: "completed",
      createdAt: 1,
    };
    setResponder(ok(record));

    const result = await client.downloadChapter("c1", "m1");

    expect(sent[0].method).toBe("POST");
    expect(pathOf(sent[0].url)).toBe("/api/chapter/c1/download");
    expect(queryOf(sent[0].url)).toMatchObject({
      mangaId: "m1",
      profile: "eink",
    });
    expect(result).toEqual(record);
  });

  it("GETs /api/downloads and returns the records", async () => {
    const client = makeClient();
    const records = [
      {
        chapterId: "c1",
        mangaId: "m1",
        cbzPath: "/d/c1.cbz",
        status: "completed",
        createdAt: 1,
      },
    ];
    setResponder(ok(records));

    const result = await client.listDownloads();

    expect(sent[0].method).toBe("GET");
    expect(pathOf(sent[0].url)).toBe("/api/downloads");
    expect(result).toEqual(records);
  });

  it("builds the CBZ URL for a downloaded chapter", () => {
    const client = makeClient();

    expect(client.downloadCbzUrl("c1")).toBe("/api/downloads/c1");
  });
});

describe("ApiClient — progress", () => {
  it("PUTs /api/progress/:mangaId with a JSON body and content-type", async () => {
    const client = makeClient();
    const progress = {
      mangaId: "m1",
      chapterId: "c1",
      page: 7,
      updatedAt: 1000,
    };
    setResponder(ok(progress));

    const result = await client.saveProgress(progress);

    expect(sent[0].method).toBe("PUT");
    expect(pathOf(sent[0].url)).toBe("/api/progress/m1");
    expect(sent[0].headers["Content-Type"]).toContain("application/json");
    expect(JSON.parse(sent[0].body as string)).toMatchObject({
      chapterId: "c1",
      page: 7,
      updatedAt: 1000,
    });
    expect(result).toEqual(progress);
  });

  it("GETs /api/progress/:mangaId and returns the stored position", async () => {
    const client = makeClient();
    const progress = {
      mangaId: "m1",
      chapterId: "c1",
      page: 7,
      updatedAt: 1000,
    };
    setResponder(ok(progress));

    const result = await client.getProgress("m1");

    expect(sent[0].method).toBe("GET");
    expect(pathOf(sent[0].url)).toBe("/api/progress/m1");
    expect(result).toEqual(progress);
  });
});

describe("ApiClient — library", () => {
  it("GETs /api/library and returns the entries", async () => {
    const client = makeClient();
    const entries = [{ mangaId: "m1", addedAt: 10 }];
    setResponder(ok(entries));

    const result = await client.listLibrary();

    expect(sent[0].method).toBe("GET");
    expect(pathOf(sent[0].url)).toBe("/api/library");
    expect(result).toEqual(entries);
  });

  it("PUTs /api/library/:mangaId with addedAt to follow", async () => {
    const client = makeClient();
    const entry = { mangaId: "m1", addedAt: 1234 };
    setResponder(ok(entry));

    const result = await client.follow("m1", 1234);

    expect(sent[0].method).toBe("PUT");
    expect(pathOf(sent[0].url)).toBe("/api/library/m1");
    expect(JSON.parse(sent[0].body as string)).toMatchObject({ addedAt: 1234 });
    expect(result).toEqual(entry);
  });

  it("DELETEs /api/library/:mangaId to unfollow", async () => {
    const client = makeClient();
    setResponder(ok({ mangaId: "m1" }));

    await client.unfollow("m1");

    expect(sent[0].method).toBe("DELETE");
    expect(pathOf(sent[0].url)).toBe("/api/library/m1");
  });
});

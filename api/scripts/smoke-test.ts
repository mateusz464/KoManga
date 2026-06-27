/**
 * API-803 — end-to-end smoke test.
 *
 * Drives the whole reading path against a *running* deployment through one base
 * URL: auth → sources → search → manga → chapter pages → page (eink + raw) →
 * download → progress write/read. Intended to be pointed at the **public
 * Cloudflare Tunnel hostname** (the deployed surface), but works against any
 * reachable base URL (e.g. the loopback-published `http://127.0.0.1:3000` from
 * API-801) so the script itself can be validated without the tunnel.
 *
 * It is an operational tool, not part of the build or the Vitest suite: it talks
 * to live infrastructure (a real Suwayomi with content), so it can't run in CI.
 *
 * Usage:
 *   AUTH_TOKEN=... BASE_URL=https://manga.example.com npm run smoke
 *
 * Config (env):
 *   BASE_URL         deployment base URL          (default http://127.0.0.1:3000)
 *   AUTH_TOKEN       single-user bearer secret    (required)
 *   SMOKE_SOURCE     source id to search          (default: first source listed)
 *   SMOKE_QUERY      search query                 (default: "")
 *   SMOKE_MANGA_ID   pin a manga id, skip search-driven discovery (optional)
 *
 * Exit code 0 = every step passed; non-zero = a step failed (message printed).
 */
import sharp from "sharp";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(
  /\/+$/,
  "",
);
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const SMOKE_SOURCE = process.env.SMOKE_SOURCE;
const SMOKE_QUERY = process.env.SMOKE_QUERY ?? "";
const SMOKE_MANGA_ID = process.env.SMOKE_MANGA_ID;

class SmokeError extends Error {}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new SmokeError(message);
  }
}

let stepNo = 0;
function step(title: string): void {
  stepNo += 1;
  console.log(`\n[${stepNo}] ${title}`);
}
function ok(detail: string): void {
  console.log(`    ✓ ${detail}`);
}

// --- HTTP helpers ---------------------------------------------------------

interface FetchOptions {
  readonly method?: string;
  readonly auth?: boolean; // attach the bearer credential (default true)
  readonly body?: unknown; // JSON-encoded when present
}

function url(path: string): string {
  return `${BASE_URL}${path}`;
}

async function call(path: string, opts: FetchOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.auth !== false) {
    headers.Authorization = `Bearer ${AUTH_TOKEN}`;
  }
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url(path), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function getJson<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const res = await call(path, opts);
  // Only consume the body for the error message on failure — reading it here
  // unconditionally would leave nothing for res.json() on the success path.
  if (!res.ok) {
    throw new SmokeError(
      `${opts.method ?? "GET"} ${path} → ${res.status} (expected 2xx): ${await safeBody(res)}`,
    );
  }
  const envelope = (await res.json()) as { data?: T };
  assert(
    envelope.data !== undefined,
    `${path} → response is missing the { data } envelope`,
  );
  return envelope.data;
}

async function getBytes(path: string): Promise<{
  bytes: Buffer;
  contentType: string;
}> {
  const res = await call(path);
  assert(res.ok, `GET ${path} → ${res.status} (expected 2xx)`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, contentType: res.headers.get("content-type") ?? "" };
}

async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<unreadable body>";
  }
}

// --- Domain shapes we read (subset of the API contracts) ------------------

interface Source {
  readonly id: string;
  readonly name: string;
}
interface MangaSummary {
  readonly id: string;
  readonly title: string;
}
interface SearchResult {
  readonly mangas: readonly MangaSummary[];
  readonly hasNextPage: boolean;
}
interface MangaView {
  readonly manga: { readonly id: string; readonly title: string };
  readonly chapters: ReadonlyArray<{
    readonly id: string;
    readonly chapterNumber: number;
  }>;
  readonly readingDirection: string;
}
interface ChapterPages {
  readonly pageCount: number;
  readonly pages: readonly string[];
}
interface DownloadRecord {
  readonly chapterId: string;
  readonly mangaId: string;
  readonly status: string;
}
interface ReadingProgress {
  readonly mangaId: string;
  readonly chapterId: string;
  readonly page: number;
  readonly updatedAt: number;
}

// --- Image checks ---------------------------------------------------------

/** Greyscale-content: a 1-channel image, or one whose R/G/B means are equal. */
async function isGreyscale(bytes: Buffer): Promise<boolean> {
  const stats = await sharp(bytes).stats();
  if (stats.channels.length < 3) {
    return true;
  }
  const [r, g, b] = stats.channels;
  return Math.abs(r.mean - g.mean) < 1 && Math.abs(g.mean - b.mean) < 1;
}

// --- The smoke test -------------------------------------------------------

async function run(): Promise<void> {
  assert(
    AUTH_TOKEN !== undefined && AUTH_TOKEN.length > 0,
    "AUTH_TOKEN env var is required",
  );
  console.log(`KoManga API smoke test → ${BASE_URL}`);

  // 1. Auth: /health public, /api guarded, valid credential passes.
  step("Auth & public surface");
  const health = await call("/health", { auth: false });
  assert(health.ok, `/health (no auth) → ${health.status} (expected 200)`);
  ok("/health is public (200, no credential)");

  const noAuth = await call("/api/sources", { auth: false });
  assert(
    noAuth.status === 401,
    `/api/sources without a credential → ${noAuth.status} (expected 401)`,
  );
  ok("/api/sources without a credential → 401");

  const badAuth = await fetch(url("/api/sources"), {
    headers: { Authorization: "Bearer not-the-token" },
  });
  assert(
    badAuth.status === 401,
    `/api/sources with a wrong credential → ${badAuth.status} (expected 401)`,
  );
  ok("/api/sources with a wrong credential → 401");

  // 2. Sources.
  step("List sources");
  const sources = await getJson<Source[]>("/api/sources");
  assert(sources.length > 0, "no sources returned (is Suwayomi configured?)");
  const source = SMOKE_SOURCE
    ? sources.find((s) => s.id === SMOKE_SOURCE)
    : sources[0];
  assert(
    source !== undefined,
    `source ${SMOKE_SOURCE ?? "(first)"} not found among ${sources.length} sources`,
  );
  ok(`valid Bearer credential → 200, ${sources.length} source(s)`);
  ok(`using source "${source.name}" (${source.id})`);

  // 3. Search — exercised even when a manga id is pinned.
  step("Search");
  const search = await getJson<SearchResult>(
    `/api/search?source=${encodeURIComponent(source.id)}&q=${encodeURIComponent(SMOKE_QUERY)}`,
  );
  ok(`search "${SMOKE_QUERY}" → ${search.mangas.length} result(s)`);

  const mangaId =
    SMOKE_MANGA_ID ??
    (search.mangas.length > 0 ? search.mangas[0].id : undefined);
  assert(
    mangaId !== undefined,
    "search returned no results — set SMOKE_QUERY to something with hits, or pin SMOKE_MANGA_ID",
  );

  // 4. Manga details + chapters.
  step("Manga details + chapters");
  const view = await getJson<MangaView>(
    `/api/manga/${encodeURIComponent(mangaId)}`,
  );
  assert(view.chapters.length > 0, `manga ${mangaId} has no chapters`);
  assert(
    typeof view.readingDirection === "string",
    "manga view is missing readingDirection",
  );
  const chapter = view.chapters[0];
  ok(
    `"${view.manga.title}" — ${view.chapters.length} chapter(s), readingDirection=${view.readingDirection}`,
  );

  // 5. Chapter page list (metadata only).
  step("Chapter page list");
  const pages = await getJson<ChapterPages>(
    `/api/chapter/${encodeURIComponent(chapter.id)}/pages`,
  );
  assert(pages.pageCount > 0, `chapter ${chapter.id} has no pages`);
  assert(
    pages.pages.length === pages.pageCount,
    `pageCount ${pages.pageCount} ≠ pages list length ${pages.pages.length}`,
  );
  const pageId = pages.pages[0];
  ok(`chapter ${chapter.id} → ${pages.pageCount} page(s), first id ${pageId}`);

  // 6. Page serving: raw passthrough vs eink processed.
  step("Page serving — raw vs eink");
  const raw = await getBytes(
    `/api/page/${encodeURIComponent(pageId)}?profile=raw`,
  );
  const eink = await getBytes(
    `/api/page/${encodeURIComponent(pageId)}?profile=eink`,
  );
  assert(raw.bytes.length > 0, "raw page returned no bytes");
  assert(eink.bytes.length > 0, "eink page returned no bytes");
  ok(`raw → ${raw.contentType}, ${raw.bytes.length} B`);
  ok(`eink → ${eink.contentType}, ${eink.bytes.length} B`);

  // raw returns source: lossless passthrough, distinct from the processed eink.
  assert(
    !raw.bytes.equals(eink.bytes),
    "raw and eink returned identical bytes — eink was not processed",
  );
  ok("raw and eink differ — raw is passthrough, eink is processed");

  // eink returns a processed image: greyscale + resized-to-fit (not enlarged).
  const rawMeta = await sharp(raw.bytes).metadata();
  const einkMeta = await sharp(eink.bytes).metadata();
  assert(await isGreyscale(eink.bytes), "eink output is not greyscale");
  ok("eink output is greyscale");
  if (rawMeta.width && rawMeta.height && einkMeta.width && einkMeta.height) {
    assert(
      einkMeta.width <= rawMeta.width && einkMeta.height <= rawMeta.height,
      `eink ${einkMeta.width}x${einkMeta.height} is larger than raw ${rawMeta.width}x${rawMeta.height}`,
    );
    ok(
      `eink ${einkMeta.width}x${einkMeta.height} fits within raw ${rawMeta.width}x${rawMeta.height}`,
    );
  }

  // 7. Download: build + persist + serve from the persistent store.
  step("Download (CBZ)");
  const record = await getJson<DownloadRecord>(
    `/api/chapter/${encodeURIComponent(chapter.id)}/download?mangaId=${encodeURIComponent(mangaId)}&profile=eink`,
    { method: "POST" },
  );
  assert(
    record.chapterId === chapter.id && record.status === "completed",
    `download record unexpected: ${JSON.stringify(record)}`,
  );
  ok(`POST download → record ${record.chapterId}, status ${record.status}`);

  const list = await getJson<DownloadRecord[]>("/api/downloads");
  assert(
    list.some((d) => d.chapterId === chapter.id),
    "downloaded chapter is not in GET /api/downloads",
  );
  ok(`GET /api/downloads lists the chapter (${list.length} total)`);

  const cbz = await getBytes(
    `/api/downloads/${encodeURIComponent(chapter.id)}`,
  );
  // Local file header magic "PK\x03\x04" — a valid CBZ is a ZIP archive.
  assert(
    cbz.bytes.length > 4 &&
      cbz.bytes[0] === 0x50 &&
      cbz.bytes[1] === 0x4b &&
      cbz.bytes[2] === 0x03 &&
      cbz.bytes[3] === 0x04,
    "stored CBZ is not a ZIP archive (bad magic)",
  );
  ok(`GET /api/downloads/:id → CBZ archive, ${cbz.bytes.length} B`);

  // 8. Progress persists across two separate client sessions.
  step("Progress write/read across separate sessions");
  const updatedAt = Date.now();
  const targetPage = Math.min(3, pages.pageCount - 1);

  // Session A: write.
  const written = await getJson<ReadingProgress>(
    `/api/progress/${encodeURIComponent(mangaId)}`,
    {
      method: "PUT",
      body: { chapterId: chapter.id, page: targetPage, updatedAt },
    },
  );
  assert(
    written.page === targetPage && written.updatedAt === updatedAt,
    `PUT progress echoed unexpected position: ${JSON.stringify(written)}`,
  );
  // Device-agnostic: no device identifier leaks into the stored record.
  assert(
    !("deviceId" in (written as unknown as Record<string, unknown>)),
    "progress record leaked a deviceId",
  );
  ok(`session A wrote chapter ${chapter.id}, page ${targetPage}`);

  // Session B: an independent client read (no shared client state).
  const readBack = await getJson<ReadingProgress>(
    `/api/progress/${encodeURIComponent(mangaId)}`,
  );
  assert(
    readBack.chapterId === chapter.id &&
      readBack.page === targetPage &&
      readBack.updatedAt === updatedAt,
    `session B read a different position: ${JSON.stringify(readBack)}`,
  );
  ok(`session B read back the same position — progress is shared, server-side`);

  console.log("\n✅ All smoke-test steps passed.");
}

run().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n❌ Smoke test failed at step ${stepNo}: ${message}`);
  process.exit(1);
});

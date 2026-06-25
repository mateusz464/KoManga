# TASKS — EPIC: API

**Project:** KoManga
**Epic:** API (the Node/TS server layer between the Kobo client and Suwayomi)
**Source of truth:** `RFC.md`
**Conventions:** `CLAUDE.md` (to follow)

## Conventions for this list

- **ID scheme:** `API-NNN`. Hundreds block = feature (1xx Bootstrap, 2xx Suwayomi Integration, 3xx Browse, 4xx Reading, 5xx Download, 6xx Progress, 7xx Auth & Security, 8xx Deployment).
- **TDD:** strict. Every implementation ticket is blocked by its paired test ticket. The test ticket writes failing tests against the agreed contract; the impl ticket makes them pass. Test tickets are marked **[TEST]**.
- **Dependencies:** strict — a ticket cannot start until all `Blocked by` tickets are Done.
- **Estimates:** T-shirt (S / M / L).
- **Acceptance criteria** are the definition of done. A ticket is not Done until all criteria pass.
- **Modularity goal:** each feature should be independently testable, with Suwayomi and image processing behind interfaces so they can be mocked.

---

# Feature: Bootstrap (1xx)

> Minimal scaffold only — just enough to build, run, lint, and test. Infra (Docker services, etc.) is added by the feature that first needs it.

### API-101 — Initialise TypeScript Node project — **Done**
**Description:** Create the repo skeleton: `package.json`, TypeScript config, project structure (`src/`, `test/`), and a runnable entrypoint that starts an HTTP server with a `/health` route.
**Acceptance criteria:**
- `npm install` succeeds from a clean clone.
- `npm run dev` starts the server; `GET /health` returns `200` with a JSON body.
- `npm run build` produces compiled output with no type errors.
**Dependencies:** none.
**Estimate:** S

### API-102 — Test & lint tooling — **Done**
**Description:** Add the test runner, an HTTP-level test helper, linter, and formatter. Wire npm scripts (`test`, `lint`, `format`).
**Acceptance criteria:**
- `npm test` runs and reports (a trivial passing test is fine).
- `npm run lint` passes on the existing code.
- A documented pattern exists for writing HTTP endpoint tests.
**Blocked by:** API-101.
**Estimate:** S

### API-103 — Config & secrets loading — **Done**
**Description:** Centralised, typed config module loading from environment (Suwayomi URL, auth token/credential, cache limits, port). Fail fast with a clear error on missing required values.
**Acceptance criteria:**
- Config is accessed through one typed module, never `process.env` scattered around.
- Missing required env var throws a descriptive error at startup.
- `.env.example` documents every variable.
**Blocked by:** API-101.
**Estimate:** S

### API-104 — [TEST] Error handling & response contract — **Done**
**Description:** Write tests defining the standard JSON error shape, status-code mapping, and a 404 fallback.
**Acceptance criteria:**
- Tests assert a consistent error body shape across thrown errors.
- Tests cover 400/401/404/500 mapping.
**Blocked by:** API-102.
**Estimate:** S

### API-105 — Error handling & response contract (impl) — **Done**
**Description:** Implement centralised error middleware and the standard response envelope to satisfy API-104.
**Acceptance criteria:**
- All API-104 tests pass.
- Unhandled errors never leak stack traces to the client.
**Blocked by:** API-104.
**Estimate:** S

---

# Feature: Suwayomi Integration Layer (2xx)

> The adapter that isolates the rest of the API from Suwayomi's GraphQL schema. Everything downstream depends on this and mocks it in tests.

### API-201 — [TEST] Suwayomi client contract — **Done**
**Description:** Define and test the interface our code uses to talk to Suwayomi (methods for list sources, search, manga details, chapter list, fetch raw page). Tests run against a mocked GraphQL transport.
**Acceptance criteria:**
- An interface (port) for the Suwayomi client exists and is documented.
- Tests cover success, GraphQL error, and network-failure cases against the mock.
**Blocked by:** API-105, API-103.
**Estimate:** M

### API-202 — Suwayomi GraphQL client (impl) — **Done**
**Description:** Implement the client against the real Suwayomi GraphQL schema, satisfying API-201. Include retry/timeout handling.
**Acceptance criteria:**
- All API-201 tests pass.
- Verified against a live Suwayomi instance (manual check noted in PR). _(2026-06-24: **PASS** against live Suwayomi **v2.2.2100** via the API-203 stack, after fixing schema drift the live check caught — search is a `fetchSourceManga` **mutation** with required `type: SEARCH`; `manga`/`chapter` ids are **`Int!`** (adapter coerces); `MangaType.genres`→`genre` (aliased); chapter pages via the `fetchChapterPages` **mutation**. All 5 adapter documents validate against the live schema; `listSources()` maps real data; GraphQL + transport/timeout errors normalise to typed `SuwayomiError` (502). 29 unit tests + lint + type-check green.)_
- Timeouts and transport errors surface as typed errors.
**Blocked by:** API-201.
**Estimate:** M

### API-203 — Suwayomi service in Compose (internal only) — **Done**
**Description:** Add the Suwayomi service to `docker-compose.yml` on an internal network (not publicly reachable), with a named data volume. First infra ticket, pulled in here because integration needs a real instance.
**Acceptance criteria:**
- `docker compose up suwayomi` starts a healthy instance.
- Suwayomi is reachable from the API container, not from the host's public interface.
- Data persists across restarts via the volume.
**Blocked by:** API-101.
**Estimate:** S

---

# Feature: Browse & Search (3xx)

> Sources, search, manga details, chapter listing. No image data yet — metadata only.

### API-301 — [TEST] List sources endpoint — **Done**
**Description:** Tests for `GET /api/sources` using a mocked Suwayomi client.
**Acceptance criteria:**
- Tests assert response shape and that it maps the client output correctly.
- Tests cover the empty-sources case.
**Blocked by:** API-202.
**Estimate:** S
**Notes (2026-06-25):** `test/http/sources.test.ts` drives the contract with the `SuwayomiClient` mocked at the port boundary and injected via `createApp({ suwayomi })`. Success envelope chosen as `{ data: ... }` to mirror the established error envelope `{ error: { code, message } }` (RFC §8 leaves shapes to implementation). Covers: maps `listSources()` output → `{ data: Source[] }`, empty-sources → `{ data: [] }`, and upstream `SuwayomiError` → 502 envelope. All 3 fail red (404, route unimplemented) pending API-302; existing 29 tests + lint green.

### API-302 — List sources endpoint (impl) — **Done**
**Description:** Implement `GET /api/sources`.
**Acceptance criteria:** All API-301 tests pass.
**Blocked by:** API-301.
**Estimate:** S
**Notes (2026-06-25):** `GET /api/sources` wired through the layers: `routes/sources.ts` (envelope only) → `services/source-service.ts` (delegates to the port) → injected `SuwayomiClient`. `createApp` now takes its ports as injected deps (`AppDependencies`); composition root (`index.ts`) constructs the real `SuwayomiGraphQLClient`/transport. Upstream `SuwayomiError` propagates to the central error middleware → 502 envelope (Express 5 forwards async rejections). All 3 API-301 tests green; full suite 32 passing, lint + build clean.

### API-303 — [TEST] Search endpoint — **Done**
**Description:** Tests for `GET /api/search?q=&source=` (mocked client): query forwarding, pagination params, empty results, missing-param validation.
**Acceptance criteria:**
- Tests cover valid search, empty result set, and missing `q`/`source` → 400.
**Blocked by:** API-202.
**Estimate:** M
**Notes (2026-06-25):** `test/http/search.test.ts` drives the contract with the `SuwayomiClient` mocked at the port boundary and injected via `createApp({ suwayomi })`. Maps URL params → `SearchParams` (`source`→`sourceId`, `q`→`query`, `page`→numeric `page`); success envelope is `{ data: SearchResult }` to mirror API-301's `{ data: ... }`. Covers: valid search forwards `q`/`source`, numeric `page` forwarding, empty result set, missing `q` → 400, missing `source` → 400 (both `BAD_REQUEST`, no client call), and upstream `SuwayomiError` → 502 envelope. All 6 fail red (404, route unimplemented) pending API-304; existing 32 tests + lint green.

### API-304 — Search endpoint (impl) — **Done**
**Description:** Implement `GET /api/search`.
**Acceptance criteria:** All API-303 tests pass.
**Blocked by:** API-303.
**Estimate:** S
**Notes (2026-06-25):** `GET /api/search` wired through the layers mirroring API-302: `routes/search.ts` (edge validation + envelope) → `services/search-service.ts` (delegates to the port) → injected `SuwayomiClient`. The route validates the query string (missing `q` or `source` → `BadRequestError` 400, no client call), maps `source`→`sourceId`/`q`→`query`, and coerces `page` to a number, omitting it when absent/non-numeric. Upstream `SuwayomiError` propagates to the central error middleware → 502 envelope. All 6 API-303 tests green; full suite 38 passing, lint + build clean.

### API-305 — [TEST] Manga details + chapter list endpoint — **Done**
**Description:** Tests for `GET /api/manga/:id` returning details plus the chapter list, with reading direction metadata included.
**Acceptance criteria:**
- Tests assert details + ordered chapter list shape.
- Tests assert reading-direction field is present.
- Unknown manga id → 404.
**Blocked by:** API-202.
**Estimate:** M
**Notes (2026-06-25):** `test/http/manga.test.ts` drives the contract with the `SuwayomiClient` mocked at the port boundary and injected via `createApp({ suwayomi })`, mirroring API-301/303. Success envelope chosen as `{ data: { manga: MangaDetails, chapters: Chapter[], readingDirection } }` — the endpoint combines the two port calls (`getMangaDetails` + `listChapters`) and adds the API-owned reading direction (RFC §6). Covers: details + chapters returned with chapters **sorted ascending by `chapterNumber`** (upstream order deliberately scrambled so the impl must sort), `readingDirection` present and defaulting to `"rtl"` (manga standard per RFC §6), empty chapter list, unknown manga → port rejects `NotFoundError` → 404 envelope (asserts the port was reached so the generic 404 fallback can't make it pass green), and upstream `SuwayomiError` → 502. All 5 fail red (404, route unimplemented) pending API-306; existing 38 tests + lint green.

### API-306 — Manga details + chapter list endpoint (impl) — **Done**
**Description:** Implement `GET /api/manga/:id`.
**Acceptance criteria:** All API-305 tests pass.
**Blocked by:** API-305.
**Estimate:** S
**Notes (2026-06-25):** `GET /api/manga/:id` wired through the layers mirroring API-302/304: `routes/manga.ts` (envelope only) → `services/manga-service.ts` → injected `SuwayomiClient`. The service combines the two port calls (`getMangaDetails` + `listChapters`, fetched in parallel), sorts chapters ascending by `chapterNumber`, and attaches the API-owned `readingDirection` (defaults to `"rtl"` per RFC §6; new `ReadingDirection` domain type lives in the service). Upstream `SuwayomiError` → 502 and `NotFoundError` → 404 both propagate to the central error middleware. All 5 API-305 tests green; full suite 47 passing, lint + build clean.
**Live verification (2026-06-25): PASS against Suwayomi v2.2.2100** (ran the real route→service→adapter→GraphQL stack from a container on the internal `komanga` network). `GET /api/manga/1` → 200 with details (incl. the `genres: genre` alias resolving live), `readingDirection: "rtl"`, and chapters ordered `[1,2,3]`. The live check **caught a contract gap**: Suwayomi returns a GraphQL non-null violation on the `manga` path for an unknown id (not `manga: null`), which the adapter's generic `run()` was normalising to `SuwayomiError` (502) — so `GET /api/manga/999999` returned 502, not the 404 the API-305 mock asserted. **Fixed in the API-202 adapter** (TDD: 4 new `client.test.ts` cases first): added `runManga()` used by `getMangaDetails` + `listChapters` (both root at `manga(id:)`, so both map not-found → `NotFoundError`, making the 404 deterministic despite the parallel `Promise.all`), plus `isMangaNotFound()` detecting the non-null-violation-on-`manga`-path signature; null-manga payload now also → `NotFoundError`. Re-verified live: `GET /api/manga/999999` → 404 `NOT_FOUND`.

---

# Feature: Reading / Page Streaming (4xx)

> The critical path. Page metadata, profile-based image processing, on-demand single-page serving, session cache, prefetch.

### API-401 — [TEST] Chapter page-list endpoint — **Done**
**Description:** Tests for `GET /api/chapter/:id/pages` returning page count + page IDs only (no image data).
**Acceptance criteria:**
- Tests assert metadata-only response (no binary payloads).
- Unknown chapter id → 404.
**Blocked by:** API-202.
**Estimate:** S
**Notes (2026-06-25):** `test/http/chapter.test.ts` drives the contract with the `SuwayomiClient` mocked at the port boundary and injected via `createApp({ suwayomi })`, mirroring API-301/303/305. Success envelope chosen as `{ data: { pageCount, pages } }`; `pages` is a list of plain **string** page ids of the form `"<chapterId>:<index>"` (0-based, ordered) — usable directly against the future `GET /api/page/:id` (API-407) and carrying no image bytes/urls. Contract gap filled: the page count needs a per-chapter lookup the port lacked (API-201 only had list/search/details/chapters/fetch-page), so added `getChapterPageCount(chapterId): Promise<number>` to the `SuwayomiClient` port and implemented it in the API-202 adapter (both it and `fetchPage` now share a private `fetchPageUrls()` over the one `fetchChapterPages` mutation, so the GraphQL coupling stays in one place per CLAUDE.md §13); 3 new adapter `client.test.ts` cases cover the count mapping, empty-pages → 0, and transport failure → `SuwayomiError`. Endpoint tests cover: page count + one id per page, string ids scoped to the chapter, metadata-only (JSON, no `bytes`/`base64`/`http`, no object page entries), empty chapter → `[]`, unknown chapter → port rejects `NotFoundError` → 404 envelope (asserts the port was reached so the generic 404 fallback can't make it pass green), and upstream `SuwayomiError` → 502. All 6 endpoint assertions fail red (404, route unimplemented) pending API-402; full suite 56 (50 passing + 6 red), lint + build clean.

### API-402 — Chapter page-list endpoint (impl) — **Done**
**Description:** Implement `GET /api/chapter/:id/pages`.
**Acceptance criteria:** All API-401 tests pass.
**Blocked by:** API-401.
**Estimate:** S
**Notes (2026-06-25):** `GET /api/chapter/:id/pages` wired through the layers mirroring API-302/304/306: `routes/chapter.ts` (envelope only) → `services/chapter-service.ts` → injected `SuwayomiClient`. The service asks the port for the page count (`getChapterPageCount`, added in API-401) and synthesises one id per page of the form `"<chapterId>:<index>"` (0-based, ordered) — metadata only, no image data. Upstream `SuwayomiError` → 502 and `NotFoundError` (unknown chapter) → 404 both propagate to the central error middleware. All 6 API-401 tests green; full suite 56 passing, lint + build clean.
**Live verification (2026-06-25): PASS against Suwayomi v2.2.2100** (ran the real route→service→adapter→GraphQL stack from a container on the internal `komanga` network). `GET /api/chapter/1/pages` → 200 with `pageCount: 93` and 93 ordered string ids `1:0`…`1:92` (metadata only — no image data). The live check **caught a contract gap** (same class as API-306): an unknown chapter returned **502, not 404**. Suwayomi signals a missing chapter on the `fetchChapterPages` mutation as a GraphQL `"Collection is empty."` error, which the adapter's generic error path was normalising to `SuwayomiError`. **Fixed in the API-202 adapter** (TDD: 4 new `client.test.ts` cases first — count not-found via `getChapterPageCount` *and* `fetchPage`, plus a non-not-found error staying `SuwayomiError`): `fetchPageUrls()` now detects the empty-collection signal (`isChapterNotFound()`) and maps it to `NotFoundError`. Re-verified live: `GET /api/chapter/999999999/pages` → 404 `NOT_FOUND`. Full suite 59 passing, lint + build clean.

### API-403 — [TEST] Image processing module — profiles — **Done**
**Description:** Tests for the processing module behind an interface: `raw` (passthrough) and `eink` (greyscale, resize-to-fit configurable resolution, contrast, compact output format). Use small fixture images.
**Acceptance criteria:**
- `raw` returns the source bytes unchanged (or losslessly).
- `eink` output is greyscale, within target dimensions, and in the configured format.
- Target resolution/format come from config, not hardcoded.
**Blocked by:** API-105, API-103.
**Estimate:** M
**Notes (2026-06-25):** Defined the `ImageProcessor` port (`src/services/ports/image-processor.ts`): `process(source, profile)` over `ImageProfile = "raw" | "eink"`, plus `SourceImage`/`ProcessedImage` (`{ bytes, contentType }`) and `EinkProfileOptions` (`targetWidth`/`targetHeight`/`format`). The eink transform's params are passed to the concrete adapter **by construction** (DI from `Config.image`), never read from env inside the adapter, so it stays reusable by future server-side clients (CLAUDE.md §6/§10). Added `sharp` to deps (verified it imports/runs as ESM on this ARM mac). `test/adapters/images/image-processor.test.ts` exercises the **real `sharp` library against fixtures** (CLAUDE.md §4.4, adapter-level), with a `SharpImageProcessor` stub whose `process()` throws so all assertions execute and fail red pending API-404. Coverage: raw → bytes unchanged + content-type preserved + no transform (stays colour, full size); eink → greyscale (verified by decoding raw pixels and asserting R==G==B, with a colour fixture whose channels differ so it can't pass by accident), fitted within target dims, aspect-ratio preserved (resize-to-fit not stretch), configured format + matching content-type; and **config-driven** proof by driving the adapter with different dims/`jpeg`/`webp` (so nothing is hardcoded). 10 tests fail red; existing 59 pass (suite 69), lint clean. (`npm run typecheck` shows one **pre-existing** error in `test/http/manga.test.ts` from API-306, present on the clean tree — unrelated to this ticket; new files type-check clean.)

### API-404 — Image processing module (impl) — **Done**
**Description:** Implement the processing module satisfying API-403.
**Acceptance criteria:** All API-403 tests pass; processing is exposed via a clean interface for reuse by future server-side clients.
**Blocked by:** API-403.
**Estimate:** M
**Notes (2026-06-25):** Implemented `SharpImageProcessor` (`src/adapters/images/sharp-image-processor.ts`) behind the API-403 `ImageProcessor` port. `raw` is a lossless passthrough (returns the `SourceImage` untouched). `eink` pipes through `sharp`: `.resize({ width, height, fit: "inside", withoutEnlargement: true })` (fits within the configured Kobo resolution, preserves aspect ratio, no upscaling) → `.greyscale()` → `.normalise()` (contrast-tune for e-ink) → `.toFormat(format)`, returning the bytes plus the format's content-type. Target dims + format come from the injected `EinkProfileOptions` (wired from `Config.image` at the composition root), never hardcoded — kept reusable for future server-side clients (CLAUDE.md §6/§10). All 10 API-403 tests green; full suite 69 passing, lint + typecheck clean.

### API-405 — [TEST] Session cache (profile-aware) — **Done**
**Description:** Tests for the ephemeral cache: keyed by page + profile, TTL expiry, size-bound eviction, hit/miss behaviour.
**Acceptance criteria:**
- Same page under `raw` vs `eink` are distinct entries.
- Expired entries are not served; eviction respects the size bound.
- Cache exposed behind an interface (mockable).
**Blocked by:** API-105, API-103.
**Estimate:** M
**Notes (2026-06-25):** Defined the `SessionCache` port (`src/services/ports/session-cache.ts`): `get(pageId, profile)` / `set(pageId, profile, page)` over `CachedPage = { bytes, contentType }`, keyed by page id **+** profile (re-uses `ImageProfile` from the image-processor port so `raw`/`eink` of one page are distinct entries). Bounds (`maxBytes`, `ttlMs`) and an **injectable `clock`** are passed to the concrete `InMemorySessionCache` adapter by construction (DI from `Config.cache` at the composition root) — the clock makes TTL deterministic without real time (CLAUDE.md §7). `test/adapters/cache/session-cache.test.ts` exercises the **real in-memory adapter** (CLAUDE.md §4.4, adapter-level) against a stub whose `get`/`set` throw, so all behavioural assertions run and fail red pending API-406. Coverage: hit/miss + overwrite; profile-aware keying (raw vs eink distinct, one profile not served for the other, distinct page ids distinct); TTL (served before, not after, re-set refreshes TTL); size-bound eviction (total live bytes ≤ bound, **oldest** evicted first, survivors retained); and a mock conforming to the port (mockability). 12 behavioural tests fail red + 1 mockability test passes; existing 69 pass (suite 82), lint + typecheck clean.

### API-406 — Session cache (impl) — **Done**
**Description:** Implement the session cache satisfying API-405.
**Acceptance criteria:** All API-405 tests pass.
**Blocked by:** API-405.
**Estimate:** M
**Notes (2026-06-25):** Implemented `InMemorySessionCache` (`src/adapters/cache/in-memory-session-cache.ts`) behind the API-405 `SessionCache` port. Backed by a single `Map` keyed by `"<pageId> <profile>"` so `raw`/`eink` of one page are distinct entries; the `Map`'s insertion order gives oldest-first eviction for free. TTL is lazy: `get()` checks `clock() - storedAt >= ttlMs` against the injected clock and drops expired entries on read (never serves them). `set()` overwrites by removing the old entry first, so re-insertion both moves the key to the newest position and refreshes its TTL; a running `totalBytes` tally drives `evictToFit()`, which evicts from the oldest end until the total is within `maxBytes`. Bounds + clock are injected by construction (DI from `Config.cache` at the composition root), nothing read from env in the adapter. All 13 API-405 tests green; full suite 82 passing, lint + build clean.

### API-407 — [TEST] Single-page endpoint with profile negotiation — **Done**
**Description:** Tests for `GET /api/page/:id?profile=` integrating Suwayomi fetch → processing → cache. Mocks Suwayomi client + processing; asserts cache-miss fetches and processes, cache-hit skips fetch.
**Acceptance criteria:**
- `profile` defaults to `raw`; `eink` triggers the eink transform.
- Cache miss → fetch + process + store; cache hit → served without refetch.
- Invalid profile → 400; unknown page → 404.
**Blocked by:** API-402, API-404, API-406.
**Estimate:** M
**Notes (2026-06-25):** `test/http/page.test.ts` drives the contract through Express with **all three** ports mocked at their boundaries and injected via `createApp` (CLAUDE.md §4): the `SuwayomiClient` (`fetchPage`), the `ImageProcessor` (`process`), and the `SessionCache` (`get`/`set`). This is the first endpoint to wire image processing + caching into the app, so `AppDependencies` gained **optional** `imageProcessor`/`sessionCache` (kept optional so the metadata endpoints' existing `createApp({ suwayomi })` call sites stay valid; API-408 reads them). Unlike the JSON metadata endpoints, a page response is the **image bytes** with the processed content-type — tests use a small `binaryParser` to buffer the body for byte-level assertions. Page ids are `<chapterId>:<index>`, so the route must split `"77:0"` back into a `PageRef { chapterId: "77", pageIndex: 0 }` (asserted on the `fetchPage` call). Coverage: default profile is `raw` + cache **miss** → `get`→`fetchPage`→`process(source,"raw")`→`set`, serving the *processor's* output (distinct bytes/type from the raw source so passthrough can't masquerade as the served body); `profile=eink` runs the eink transform and keys cache by `eink`; cache **hit** serves the stored bytes and **skips** `fetchPage`/`process`/`set` entirely; unsupported `profile=sepia` → 400 rejected at the edge (nothing downstream touched); unknown page → `fetchPage` rejects `NotFoundError` → 404 (asserts the fetch was reached so the generic 404 fallback can't make it pass green); upstream `SuwayomiError` → 502 envelope. All 6 fail red (404, route unimplemented) pending API-408; existing 82 tests pass (suite 88), lint + typecheck clean.

### API-408 — Single-page endpoint (impl)
**Description:** Implement `GET /api/page/:id?profile=`.
**Acceptance criteria:** All API-407 tests pass.
**Blocked by:** API-407.
**Estimate:** M

### API-409 — [TEST] Background prefetch
**Description:** Tests that requesting page N triggers background prefetch of the next configurable window, into the cache, without blocking the response.
**Acceptance criteria:**
- Response for page N does not wait on prefetch.
- Prefetched pages produce cache hits when later requested.
- Prefetch window is configurable.
**Blocked by:** API-407.
**Estimate:** M

### API-410 — Background prefetch (impl)
**Description:** Implement prefetch satisfying API-409.
**Acceptance criteria:** All API-409 tests pass.
**Blocked by:** API-409.
**Estimate:** M

---

# Feature: Chapter Download / CBZ (5xx)

> Explicit, persistent downloads — separate from the ephemeral session cache.

### API-501 — [TEST] SQLite layer & migrations
**Description:** Tests for the data layer: schema/migrations for `downloads`, `reading_progress`, `cache_index`; basic CRUD behind a repository interface.
**Acceptance criteria:**
- Migrations create the schema on a fresh DB.
- Repository CRUD covered by tests against a temp DB.
- DB access is behind interfaces (mockable for upstream tests).
**Blocked by:** API-105, API-103.
**Estimate:** M

### API-502 — SQLite layer & migrations (impl)
**Description:** Implement the data layer satisfying API-501.
**Acceptance criteria:** All API-501 tests pass.
**Blocked by:** API-501.
**Estimate:** M

### API-503 — [TEST] CBZ builder
**Description:** Tests for assembling processed pages into a valid CBZ archive with correct page ordering.
**Acceptance criteria:**
- Produced archive is a valid CBZ openable by a standard reader (assert via unzip + ordering).
- Page order matches chapter order.
**Blocked by:** API-404.
**Estimate:** M

### API-504 — CBZ builder (impl)
**Description:** Implement the CBZ builder satisfying API-503.
**Acceptance criteria:** All API-503 tests pass.
**Blocked by:** API-503.
**Estimate:** M

### API-505 — [TEST] Download endpoints
**Description:** Tests for `POST /api/chapter/:id/download` (build + persist + record) and `GET /api/downloads` (list), plus serving a stored CBZ. Persistent store must survive session-cache pruning.
**Acceptance criteria:**
- Download records persist in SQLite with status.
- Downloaded chapter is served from the persistent store, not the ephemeral cache.
- Re-download of an existing chapter is idempotent (no duplicate).
**Blocked by:** API-502, API-504.
**Estimate:** M

### API-506 — Download endpoints (impl)
**Description:** Implement the download endpoints + persistent store satisfying API-505.
**Acceptance criteria:** All API-505 tests pass; persistent CBZ store mounted on a Docker volume.
**Blocked by:** API-505.
**Estimate:** M

---

# Feature: Reading Progress Sync (6xx)

> Device-agnostic, server-side, last-write-wins. Keyed by manga/chapter/page.

### API-601 — [TEST] Progress endpoints
**Description:** Tests for `GET /api/progress/:mangaId` and `PUT /api/progress/:mangaId` (manga/chapter/page + updated_at), last-write-wins semantics.
**Acceptance criteria:**
- PUT then GET returns the stored position.
- A newer `updated_at` overwrites an older one; an older write does not clobber a newer one.
- Progress is not tied to any device identifier.
**Blocked by:** API-502.
**Estimate:** M

### API-602 — Progress endpoints (impl)
**Description:** Implement the progress endpoints satisfying API-601.
**Acceptance criteria:** All API-601 tests pass.
**Blocked by:** API-601.
**Estimate:** S

### API-603 — [TEST] Library endpoint
**Description:** Tests for `GET /api/library` (followed/saved manga) backed by SQLite.
**Acceptance criteria:**
- Add/remove + list covered.
- Empty library case covered.
**Blocked by:** API-502.
**Estimate:** S

### API-604 — Library endpoint (impl)
**Description:** Implement `GET /api/library` and follow/unfollow.
**Acceptance criteria:** All API-603 tests pass.
**Blocked by:** API-603.
**Estimate:** S

---

# Feature: Auth & Security (7xx)

> Single-user but multi-client. Applies across the whole API.

### API-701 — [TEST] Single-user auth middleware
**Description:** Tests that all `/api/*` routes require a valid token/credential; missing/invalid → 401; valid passes through. Token scheme must not assume a single device.
**Acceptance criteria:**
- Protected route without credential → 401.
- Valid credential → handler runs.
- `/health` remains public.
**Blocked by:** API-105, API-103.
**Estimate:** M

### API-702 — Single-user auth middleware (impl)
**Description:** Implement auth middleware satisfying API-701, applied globally to `/api/*`.
**Acceptance criteria:** All API-701 tests pass; credential sourced from config/secret, never hardcoded.
**Blocked by:** API-701.
**Estimate:** S

### API-703 — [TEST] Rate limiting
**Description:** Tests for per-client rate limiting on API routes (limit, window, 429 on exceed).
**Acceptance criteria:**
- Requests over the limit in a window → 429.
- Limit/window configurable.
**Blocked by:** API-701.
**Estimate:** S

### API-704 — Rate limiting (impl)
**Description:** Implement rate limiting satisfying API-703.
**Acceptance criteria:** All API-703 tests pass.
**Blocked by:** API-703.
**Estimate:** S

---

# Feature: Deployment (8xx)

> Full Compose stack + public exposure. Done last; depends on the services existing.

### API-801 — API service in Compose
**Description:** Add the Node API to `docker-compose.yml`: build, env/secrets, volumes (SQLite, CBZ store), `depends_on: suwayomi`, joined to the internal network.
**Acceptance criteria:**
- `docker compose up` brings up Suwayomi + API healthy.
- API reaches Suwayomi over the internal network.
- SQLite + CBZ volumes persist across restarts.
**Blocked by:** API-203, API-506, API-602, API-702.
**Estimate:** M

### API-802 — Cloudflare Tunnel connector
**Description:** Add the `cloudflared` service pointing at the API; document tunnel + (optional) Cloudflare Access setup. No inbound router ports.
**Acceptance criteria:**
- API reachable over HTTPS via the tunnel hostname.
- Suwayomi is NOT reachable publicly.
- No inbound ports opened on the home router.
**Blocked by:** API-801, API-704.
**Estimate:** M

### API-803 — Smoke-test the full path end-to-end
**Description:** Manual + scripted smoke test through the public tunnel: auth → search → manga → page (`eink`) → download → progress write/read.
**Acceptance criteria:**
- Every step succeeds through the public hostname with auth.
- `eink` page returns a processed image; `raw` returns source.
- Progress persists across two separate client sessions.
**Blocked by:** API-802.
**Estimate:** M

---

## Suggested build order (respecting strict deps)

1. **Bootstrap:** API-101 → 102/103 → 104 → 105
2. **Suwayomi:** API-203 (parallel) , API-201 → 202
3. **Browse:** 3xx (parallel branches once 202 done)
4. **Reading:** 401/402, 403/404, 405/406 → 407/408 → 409/410
5. **Download:** 501/502, 503/504 → 505/506
6. **Progress:** 601/602, 603/604
7. **Auth/Security:** 701/702 → 703/704 (can start once 105 done; apply globally before deploy)
8. **Deploy:** 801 → 802 → 803

> Note: Auth (7xx) only depends on the bootstrap layer, so it can be built early in parallel even though it's listed late. Everything funnels into API-801 for deployment.

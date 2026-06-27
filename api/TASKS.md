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

### API-408 — Single-page endpoint (impl) — **Done**
**Description:** Implement `GET /api/page/:id?profile=`.
**Acceptance criteria:** All API-407 tests pass.
**Blocked by:** API-407.
**Estimate:** M
**Notes (2026-06-25):** `GET /api/page/:id?profile=` wired through the layers mirroring the metadata endpoints, but it is the first endpoint to integrate all three reading ports: `routes/page.ts` (profile negotiation + binary response) → `services/page-service.ts` → injected `SuwayomiClient` + `ImageProcessor` + `SessionCache`. The route validates `profile` at the edge (defaults to `raw`; only `raw`/`eink`, else `BadRequestError` 400 before any port is touched) and streams the served bytes via `res.type(contentType).send(bytes)` rather than the JSON envelope. The service runs the critical-path flow: `get(pageId, profile)` → on hit, serve and short-circuit the upstream; on miss, `fetchPage(ref)` → `process(source, profile)` → `set(pageId, profile, processed)` → serve the processed output. Page ids `"<chapterId>:<index>"` (minted by API-402) are split back into a `PageRef` in the service (last-colon split). `imageProcessor`/`sessionCache` were already optional on `AppDependencies` (added in API-407); the page router is mounted only when both are present, so metadata-only `createApp({ suwayomi })` call sites stay valid. Composition root (`index.ts`) now constructs the real `SharpImageProcessor` (from `Config.image`) and `InMemorySessionCache` (`Config.cache`, `ttlMs = ttlSeconds * 1000`). Upstream `NotFoundError` → 404 and `SuwayomiError` → 502 propagate to the central error middleware. All 6 API-407 tests green; full suite 88 passing, lint + typecheck clean.
**Live verification (2026-06-25): PASS against Suwayomi v2.2.2100** (ran the real route→service→adapter→GraphQL stack natively, reaching the internal-only Suwayomi via a temporary **loopback-only** TCP forwarder on the `komanga_komanga` network — Suwayomi itself stays unexposed, no host port published, forwarder torn down after). This is the first endpoint to exercise **API-404 (sharp) and API-406 (cache) against real page bytes**, not fixtures/mocks. `GET /api/page/1:0?profile=raw` → 200 `image/jpeg`, 800×2000, 3-channel colour, source bytes passed through **unchanged** (465941 B in = out). `?profile=eink` → 200 `image/png`, **579×1448** — fitted inside the configured 1072×1448 with aspect ratio preserved (2000→1448 scales 800→579), no upscaling; decoding the raw pixels confirmed **greyscale content** (every sampled pixel R==G==B, the same property the API-403 adapter test asserts). **Cache hit proven by killing the upstream forwarder** and re-requesting: the already-cached `1:0` (both profiles) still served 200 from cache while an uncached page (`1:1`) failed `502` — so a hit genuinely short-circuits the fetch (RFC §5). Edge cases live: `?profile=sepia` → 400 `BAD_REQUEST` (edge-rejected, no upstream touched); unknown chapter `999999999:0` → 404 `NOT_FOUND` (via the adapter's `isChapterNotFound`, same path as API-402); upstream-down → 502 `SUWAYOMI_ERROR`. No code changes needed — the mocked API-407 contract matched live behaviour exactly.

### API-409 — [TEST] Background prefetch — **Done**
**Description:** Tests that requesting page N triggers background prefetch of the next configurable window, into the cache, without blocking the response.
**Acceptance criteria:**
- Response for page N does not wait on prefetch.
- Prefetched pages produce cache hits when later requested.
- Prefetch window is configurable.
**Blocked by:** API-407.
**Estimate:** M
**Notes (2026-06-25):** `test/services/page-service.test.ts` drives the prefetch contract at the **service layer** (CLAUDE.md §3/§4 — prefetch is business logic, so it is tested in `PageService` with all three ports mocked at their boundaries: the `SuwayomiClient`, the `ImageProcessor`, and a small **storing** fake of the `SessionCache` so prefetched pages can actually be served as later hits). The prefetch window is supplied to `PageService` by construction (wired from `Config.prefetch.window` at the composition root in API-410). Page ids are `<chapterId>:<index>` (API-402), so the window for `77:0` is `77:1`…`77:N`, bounded by the chapter's page count via the existing `getChapterPageCount` port (no new port methods). Scaffold: `PageService` gained a 4th constructor param `prefetchWindow = 0` that it currently ignores — same red-test-that-executes pattern as the API-403/405 stubs (a default of 0 keeps `createApp`/`index.ts` compiling unchanged). Coverage: warms the next `window` pages without overshooting; **non-blocking** (prefetch fetches gated on a deferred — `getPage` resolves page N with only its own `set`, then the window settles once the gate opens); prefetched → **cache hit** on the next request (page 1 served from cache, fetched exactly once — by the earlier prefetch); window **configurable** (`it.each` 2 vs 5 → exactly that many pages); **bounded** by the last page (index 91 of 93 prefetches only 92, never 93/94); same **profile** as the request (eink prefetch keys eink, not raw); **skips** already-cached pages; **swallows** prefetch failures without affecting the served page or leaking an unhandled rejection; and window **0 disables** prefetch (this last one passes green against the stub — the impl must keep it green). 9 prefetch assertions fail red (`vi.waitFor` timeouts — the stub does not prefetch) pending API-410; existing 88 tests still pass (suite 98: 89 passing + 9 red), lint + typecheck clean.

### API-410 — Background prefetch (impl) — **Done**
**Description:** Implement prefetch satisfying API-409.
**Acceptance criteria:** All API-409 tests pass.
**Blocked by:** API-409.
**Estimate:** M
**Notes (2026-06-25):** Prefetch implemented in `PageService` (`src/services/page-service.ts`), keeping it in the service layer (CLAUDE.md §3) and behind the existing ports — no new port methods. `getPage` now `serve()`s the page exactly as before (cache hit short-circuits; miss → fetch → process → store) and then kicks off `prefetch()` **fire-and-forget** (`void … .catch(() => {})`) so the reader's response never waits on it (RFC §5). `prefetch()` parses the `<chapterId>:<index>` id, asks the `getChapterPageCount` port for the bound (`lastIndex = count - 1`), and warms indices `index+1 … min(index+window, lastIndex)` — never past the last page. Each page goes through `warm()`, which **skips** anything already cached (`get` hit) and otherwise fetch→process→`set`s under the **same profile**; per-page and whole-`prefetch` failures are swallowed (best-effort, must not affect the served page or leak an unhandled rejection). Window 0 returns early (prefetch disabled). The window is wired configurably from `Config.prefetch.window`: `AppDependencies` gained optional `prefetchWindow`, `createApp` passes it to `PageService`, and the composition root (`index.ts`) supplies `config.prefetch.window`. All 9 red API-409 assertions now pass (the window-0 test stayed green); full suite 98 passing, lint + typecheck clean.
**Live verification (2026-06-25): PASS against Suwayomi v2.2.2100** (ran the real route→service→adapter→GraphQL stack natively, reaching the internal-only Suwayomi via a temporary loopback-only forwarder on the `komanga_komanga` network — Suwayomi stayed unpublished, forwarder torn down after, container still healthy). All three acceptance criteria confirmed end-to-end by warming the cache then **cutting the upstream**: **prefetched → cache hits** (window=3: after the upstream was killed, `1:1`–`1:3` still served `200` from cache in 2–6 ms with distinct real page sizes, while `1:4` outside the window → `502`); **window configurable** (window=1 cached only `1:1` with `1:2`→`502`; window=5 cached `1:1`–`1:5` with `1:6`→`502`); **non-blocking** (a single uncached page ≈ 0.60 s, yet `1:0` with window=5 returned in **0.93 s** — ≈ one page, not ~6× — while all 5 following pages still landed in the cache). No code changes needed — live behaviour matched the mocked API-409 contract exactly.

---

# Feature: Chapter Download / CBZ (5xx)

> Explicit, persistent downloads — separate from the ephemeral session cache.

### API-501 — [TEST] SQLite layer & migrations — **Done**
**Description:** Tests for the data layer: schema/migrations for `downloads`, `reading_progress`, `cache_index`; basic CRUD behind a repository interface.
**Acceptance criteria:**
- Migrations create the schema on a fresh DB.
- Repository CRUD covered by tests against a temp DB.
- DB access is behind interfaces (mockable for upstream tests).
**Blocked by:** API-105, API-103.
**Estimate:** M
**Notes (2026-06-26):** Defined three repository ports in `src/services/ports/` (one per RFC §7 table): `ReadingProgressRepository` (device-agnostic — keyed by manga only, no device id; `save` is **last-write-wins** by `updatedAt`), `DownloadsRepository` (keyed by chapter; `create` **idempotent** per chapter for re-download; `get`/`list`/`updateStatus`), and `CacheIndexRepository` (session-cache bookkeeping — `get`/`upsert`/`delete`/`list`/`totalBytes`). The `better-sqlite3` `Database` type stays inside the adapter and never crosses a port boundary (CLAUDE.md §11); domain types live in the port files. Added `better-sqlite3` + `@types/better-sqlite3` to deps (verified the native ARM build imports/runs). `test/adapters/db/sqlite.test.ts` exercises the **real `better-sqlite3` library on a temp on-disk DB** (CLAUDE.md §4.4, adapter-level) via stub adapters (`src/adapters/db/`: an `openDatabase` that throws + repository classes whose methods throw) so all behavioural assertions execute and fail red pending API-502. Coverage: **migrations** create the `reading_progress`/`downloads`/`cache_index` tables on a fresh DB and re-running on an already-migrated file is safe + preserves data (run-on-startup); **reading_progress** get/save round-trip, one-row-per-manga (device-agnostic), and last-write-wins both directions (newer overwrites, stale write does not clobber); **downloads** get/list/empty, create + list-all, idempotent create (no duplicate, original kept), updateStatus; **cache_index** get/miss, empty list + zero total, upsert + replace, delete (incl. no-op on absent key), totalBytes sum. Plus a **mockability** test per port (these 3 pass green, proving the interfaces are mockable for upstream tests — API-505/601). 19 behavioural assertions fail red + 3 mockability pass; existing 98 tests still pass (suite 120: 101 passing + 19 red), lint + typecheck clean.

### API-502 — SQLite layer & migrations (impl) — **Done**
**Description:** Implement the data layer satisfying API-501.
**Acceptance criteria:** All API-501 tests pass.
**Blocked by:** API-501.
**Estimate:** M
**Notes (2026-06-26):** Implemented the real `better-sqlite3` connection + the three repositories behind the API-501 ports. `openDatabase` (`src/adapters/db/database.ts`) opens the file, sets `journal_mode=WAL`, and runs the plain-SQL migrations on every startup — all `CREATE TABLE IF NOT EXISTS` so re-opening an already-migrated DB is safe and preserves data (RFC §7, CLAUDE.md §8). The concrete `Database` type stays inside the adapter; rows are mapped snake_case↔camelCase so no library type crosses a port boundary (CLAUDE.md §11). `SqliteReadingProgressRepository.save` is **last-write-wins** via `INSERT … ON CONFLICT(manga_id) DO UPDATE … WHERE excluded.updated_at >= reading_progress.updated_at` (one row per manga, device-agnostic — a stale write can't clobber). `SqliteDownloadsRepository.create` is **idempotent** via `INSERT OR IGNORE` (re-download keeps the original row); `updateStatus` is a plain `UPDATE`. `SqliteCacheIndexRepository` upserts via `ON CONFLICT(key) DO UPDATE`, with `totalBytes` as `COALESCE(SUM(size_bytes),0)`. All 19 red API-501 assertions now pass (+3 mockability still green); full suite 120 passing, lint + typecheck clean.
**E2E verification (2026-06-26): PASS** against the real native `better-sqlite3` ARM build on a real on-disk file, **across two separate node processes** (the DB layer isn't wired into any route yet — downloads/progress endpoints land in API-505/506/601 — so there's nothing HTTP-reachable to boot; the meaningful E2E is real-process persistence, beyond the single-process vitest). Process 1 opened a fresh file → migrations created `cache_index`/`downloads`/`reading_progress`, then wrote across all three repos. Process 2 reopened the same file (migrations re-ran without error) and read back: reading_progress `page: 7` (the stale `updatedAt: 2000` write did **not** clobber the `5000` one — last-write-wins survives a restart); the download had `status: "completed"` but kept its **original** `cbzPath` and a count of **1** (idempotent create + updateStatus); `cache_index.totalBytes()` summed to `3048`. No code changes needed.

### API-503 — [TEST] CBZ builder — **Done**
**Description:** Tests for assembling processed pages into a valid CBZ archive with correct page ordering.
**Acceptance criteria:**
- Produced archive is a valid CBZ openable by a standard reader (assert via unzip + ordering).
- Page order matches chapter order.
**Blocked by:** API-404.
**Estimate:** M
**Notes (2026-06-26):** Defined the `CbzBuilder` port (`src/services/ports/cbz-builder.ts`): `build(pages): Promise<Buffer>` over `CbzPage = { bytes, contentType }` — `ProcessedImage` (API-403) satisfies the shape structurally, so the download service (API-505/506) can pass processed pages straight in. The builder is **pure**: it returns the archive bytes and knows nothing about storage; persisting the CBZ to the download volume + recording it in SQLite stays the download service's concern (kept separate from the ephemeral session cache, RFC §5/§7). Per CLAUDE.md §4.4 the adapter is exercised **for real** — `test/adapters/cbz/cbz-builder.test.ts` writes each produced archive to a temp file and verifies it with the **system `unzip`** (a standard reader), so validity means "a real archive tool accepts it", not a round-trip through the same writer library. The concrete `ZipCbzBuilder` (`src/adapters/cbz/zip-cbz-builder.ts`) is a stub whose `build()` throws (same red-test-that-executes pattern as the API-501/403/405 stubs) so all assertions run and fail red pending API-504. Coverage: archive passes `unzip -t` integrity check (**valid CBZ openable by a standard reader**); exactly one entry per page; page **bytes stored verbatim** (no re-encode — pages are already processed); **order matches chapter order** proven with **12 distinct solid-colour pages** decoded back and byte-compared in the reader's lexicographic filename order, so the 9→10 boundary forces zero-padded names (un-padded `1.png`..`12.png` would sort `1,10,11,12,2,…` and fail); entry **file extension derived from each page's content type** (png/jpeg/webp), order preserved; valid single-page archive; plus a **mockability** test (passes green — proves the port can stand in for upstream API-505). 6 behavioural assertions fail red + 1 mockability passes; existing 121 tests still pass (suite 127: 121 passing + 6 red), lint + typecheck clean.

### API-504 — CBZ builder (impl) — **Done**
**Description:** Implement the CBZ builder satisfying API-503.
**Acceptance criteria:** All API-503 tests pass.
**Blocked by:** API-503.
**Estimate:** M
**Notes (2026-06-26):** Implemented `ZipCbzBuilder` (`src/adapters/cbz/zip-cbz-builder.ts`) behind the API-503 `CbzBuilder` port. No ZIP library is in the stack (CLAUDE.md §2), and the contract requires page bytes stored **verbatim** — which maps exactly to ZIP's **STORE** method (no compression; recompressing already-`ImageProcessor`-processed images would only waste CPU). So rather than add a dependency, the adapter writes a minimal, self-contained ZIP by hand: per-page local file header + raw data, a central directory, and the end-of-central-directory record, all little-endian, with a table-based **CRC-32** over each page's bytes. Entry names are **zero-padded** to the width of the page count (`01.png`…`12.png`), so a reader's lexicographic order matches chapter order across the 9→10 boundary; the extension is **derived from each page's content type** (`image/jpeg`→`jpg`, else the subtype). The builder stays **pure** — returns the archive `Buffer`, knows nothing about storage (that's the download service's concern, API-505/506). All 6 red API-503 assertions now pass (+1 mockability still green), verified by the contract test's real system-`unzip` integrity check + byte-for-byte extraction; full suite 127 passing, lint + typecheck + build + format clean.

### API-505 — [TEST] Download endpoints — **Done**
**Description:** Tests for `POST /api/chapter/:id/download` (build + persist + record) and `GET /api/downloads` (list), plus serving a stored CBZ. Persistent store must survive session-cache pruning.
**Acceptance criteria:**
- Download records persist in SQLite with status.
- Downloaded chapter is served from the persistent store, not the ephemeral cache.
- Re-download of an existing chapter is idempotent (no duplicate).
**Blocked by:** API-502, API-504.
**Estimate:** M
**Notes (2026-06-26):** `test/http/downloads.test.ts` drives the contract through Express with **every port mocked at its boundary** (CLAUDE.md §4) and injected via `createApp`, mirroring the API-407 page-endpoint test (real service + route, mocked ports). This is the first feature to wire the persistent download path, so it defines a new **`DownloadStore` port** (`src/services/ports/download-store.ts`) — `save(chapterId, cbz)→path` / `read(chapterId)→Buffer?` — that hides the CBZ volume behind an interface, kept conceptually/physically separate from the session cache (RFC §5.2/§7). `AppDependencies` gained **optional** `cbzBuilder`/`downloadStore`/`downloadsRepository` (kept optional so existing `createApp` call sites stay valid; API-506 mounts the router + reads them), reusing the existing `CbzBuilder` (API-503), `DownloadsRepository` (API-501) and `ImageProcessor` (API-403) ports — no upstream `SuwayomiClient` change. Contract decisions pinned (RFC §8 leaves shapes to impl): the download is keyed by chapter and the chapter's `mangaId` is a **required query param** (the client is on the manga when it triggers the download, and the port has no chapter→manga lookup — avoids an upstream round-trip and storing duplicated catalogue data, RFC §7); pages are processed under a **negotiable `profile`** defaulting to `raw` like the page endpoint (RFC §6), unsupported → 400; success is the standard `{ data: ... }` envelope; the served CBZ is the archive **bytes** with `application/vnd.comicbook+zip`. The mocked repo + store are small **stateful in-memory fakes** so re-download/list/serve behaviour is observable across calls within a test. Coverage: POST fetches **all** pages in chapter order → processes → hands the ordered processed pages to `cbzBuilder.build` → `store.save` → `repo.create` a `completed` record carrying the store's path (the three acceptance facts: persisted record + status, built+stored on the persistent volume); profile **default raw** + negotiated **eink**; **idempotent re-download** (existing record short-circuits — no fetch/process/build/save, no duplicate `create`, list stays length 1); missing `mangaId` → 400 and unsupported `profile` → 400 (both edge-rejected, nothing downstream touched); upstream `SuwayomiError` → 502; `GET /api/downloads` lists records + empty case; `GET /api/downloads/:chapterId` serves the stored CBZ bytes **from `store.read`** while the injected **session cache is asserted untouched** (served from the persistent store, not the ephemeral cache — criterion #2), unknown download → 404 (asserts `repo.get` was reached so the generic 404 fallback can't make it pass green). All 11 fail red (404, routes unmounted) pending API-506; existing 127 tests pass (suite 138: 127 passing + 11 red), lint + typecheck clean.

### API-506 — Download endpoints (impl) — **Done**
**Description:** Implement the download endpoints + persistent store satisfying API-505.
**Acceptance criteria:** All API-505 tests pass; persistent CBZ store mounted on a Docker volume.
**Blocked by:** API-505.
**Estimate:** M
**Notes (2026-06-26):** The three endpoints wired through the layers mirroring the page endpoint (real service + route, ports injected): `routes/downloads.ts` (edge validation + envelope/binary response) → new `services/download-service.ts` → injected `SuwayomiClient` + `ImageProcessor` + `CbzBuilder` + `DownloadStore` + `DownloadsRepository`. `POST /api/chapter/:id/download` validates `mangaId` (required query param — the client is on the manga when it triggers the download, and the port has no chapter→manga lookup) and `profile` (defaults `raw`, only `raw`/`eink`, else 400) at the edge before any port is touched; the service short-circuits on an existing record (**idempotent** — no fetch/process/build/save/create, returns the stored record), else fetches **every page in chapter order sequentially** → processes under the profile → `cbzBuilder.build` → `store.save` → `repo.create` a `completed` record carrying the store's path. `GET /api/downloads` lists records; `GET /api/downloads/:chapterId` serves the CBZ bytes **from `store.read`** (persistent store, never the session cache) with `application/vnd.comicbook+zip`, unknown download → 404 (service reaches `repo.get`). Implemented the concrete `FilesystemDownloadStore` (`src/adapters/store/filesystem-download-store.ts`) behind the API-505 `DownloadStore` port: writes `<baseDir>/<chapterId>.cbz` (mkdir -p), reads back, maps `ENOENT`→`undefined`; base dir injected from `Config.paths.cbzStore`. Composition root (`index.ts`) now opens the DB (`openDatabase`) and constructs `ZipCbzBuilder` + `FilesystemDownloadStore` + `SqliteDownloadsRepository`, passing them to `createApp` (the download router mounts only when builder + store + repo + image processor are all present). Declared a named `cbz-store` Docker volume in `docker-compose.yml` for the persistent store (mounted by the `api` service when it joins the stack in API-801, kept separate from the session cache). All 11 API-505 tests green; full suite 138 passing, lint + typecheck + build + format clean.

---

# Feature: Reading Progress Sync (6xx)

> Device-agnostic, server-side, last-write-wins. Keyed by manga/chapter/page.

### API-601 — [TEST] Progress endpoints — **Done**
**Description:** Tests for `GET /api/progress/:mangaId` and `PUT /api/progress/:mangaId` (manga/chapter/page + updated_at), last-write-wins semantics.
**Acceptance criteria:**
- PUT then GET returns the stored position.
- A newer `updated_at` overwrites an older one; an older write does not clobber a newer one.
- Progress is not tied to any device identifier.
**Blocked by:** API-502.
**Estimate:** M
**Notes (2026-06-26):** `test/http/progress.test.ts` drives the contract through Express with the `ReadingProgressRepository` mocked at the port boundary (CLAUDE.md §4) and injected via `createApp`, mirroring the API-505 stateful-fake pattern (real route + service, ports mocked). The `ReadingProgress` port already existed (API-501), so no new port — `AppDependencies` gained **optional** `readingProgressRepository` (kept optional so existing `createApp` call sites stay valid; API-602 mounts the router + reads it). Contract decisions pinned (RFC §7/§8): `mangaId` comes from the **URL**, the PUT body carries only `chapterId`/`page`/`updatedAt` (device-agnostic — a `deviceId` in the body is ignored, never persisted); **last-write-wins lives in the repository** (the faithful in-memory fake implements it: `updatedAt >=` overwrites, stale write is a no-op), so the endpoints just forward to `save`/`get`; PUT returns the **resolved** current position (save then get) so a stale write visibly returns the newer stored value; success is the standard `{ data: ... }` envelope; a manga with no stored progress yet → 404. Coverage: PUT stores keyed by URL manga id + returns it; PUT→GET round-trip; newer `updatedAt` overwrites older; older does **not** clobber newer (and the stale PUT itself resolves to the newer position); device-agnostic (saved record has exactly the four fields, no `deviceId` leaks into store or response); edge validation → 400 (missing `chapterId`, non-numeric `page`, missing `updatedAt`, all before `save` is touched); GET returns the stored position; unknown manga → `repo.get` reached → 404 (asserts the port was reached so the generic 404 fallback can't make it pass green). All 10 fail red (404, route unmounted) pending API-602; existing 138 tests pass (suite 148: 138 passing + 10 red), lint + typecheck clean.

### API-602 — Progress endpoints (impl) — **Done**
**Description:** Implement the progress endpoints satisfying API-601.
**Acceptance criteria:** All API-601 tests pass.
**Blocked by:** API-601.
**Estimate:** S
**Notes (2026-06-26):** The two endpoints wired through the layers mirroring the prior impl tickets (real route + service, port injected): `routes/progress.ts` (edge validation + envelope) → new `services/progress-service.ts` → injected `ReadingProgressRepository` (the port already existed from API-501; no new port). `PUT /api/progress/:mangaId` parses the JSON body with `express.json()` mounted on the route (the first endpoint to read a request body — kept local to the PUT so the other routes stay body-parser-free), validates `chapterId`/`page`/`updatedAt` at the edge (missing `chapterId`, non-numeric `page`, missing `updatedAt` → 400 before `save` is touched), and builds the `ReadingProgress` from **exactly** our four fields with `mangaId` from the URL — any `deviceId` in the body is dropped here, never persisted (device-agnostic, RFC §7). The service `save()`s then re-`get()`s and returns the **resolved** position, so a stale write (older `updatedAt`) lands as a repo no-op (LWW lives in the repository) yet visibly returns the newer stored value. `GET /api/progress/:mangaId` returns the stored position; a manga with none yet → 404. The progress router mounts whenever `readingProgressRepository` is wired in; composition root (`index.ts`) constructs `SqliteReadingProgressRepository` over the already-open DB. All 10 API-601 tests green; full suite 148 passing, lint + typecheck + format clean.

### API-603 — [TEST] Library endpoint — **Done**
**Description:** Tests for `GET /api/library` (followed/saved manga) backed by SQLite.
**Acceptance criteria:**
- Add/remove + list covered.
- Empty library case covered.
**Blocked by:** API-502.
**Estimate:** S
**Notes (2026-06-26):** `test/http/library.test.ts` drives the contract through Express with the `LibraryRepository` mocked at the port boundary (CLAUDE.md §4) and injected via `createApp`, mirroring the API-601 stateful-fake pattern (real route + service, port mocked). Defines a new **`LibraryRepository` port** (`src/services/ports/library-repository.ts`) — `list`/`add`/`remove` over a minimal `LibraryEntry = { mangaId, addedAt }` that stores only the reference + timestamp, never Suwayomi catalogue metadata (fetched on demand, CLAUDE.md §8), and is device-agnostic like reading progress (keyed by manga only, RFC §7). `AppDependencies` gained **optional** `libraryRepository` (kept optional so existing `createApp` call sites stay valid; API-604 mounts the router + reads it — no router mounted here). Contract decisions pinned (RFC §7/§8): `mangaId` from the URL; `addedAt` (epoch ms) supplied in the PUT body, mirroring progress's `updatedAt` (device-agnostic, stable sort key — a `deviceId` in the body is ignored, never persisted); endpoints `GET /api/library` → `{ data: LibraryEntry[] }`, `PUT /api/library/:mangaId` (follow, **idempotent** — re-follow keeps the original row, no duplicate), `DELETE /api/library/:mangaId` (unfollow, **no-op** if absent); success uses the standard `{ data: ... }` envelope; empty library → `{ data: [] }`. Coverage hits the acceptance criteria (add/remove + list; empty library) plus PUT→GET round-trip, idempotent re-follow, device-agnostic body handling, and edge validation (missing/non-numeric `addedAt` → 400 before `add` is touched); the not-followed DELETE asserts `remove` was reached so the generic 404 fallback can't make it pass green. All 10 fail red (404, router unmounted) pending API-604; existing 148 tests pass (suite 158: 148 passing + 10 red), lint + typecheck clean.

### API-604 — Library endpoint (impl) — **Done**
**Description:** Implement `GET /api/library` and follow/unfollow.
**Acceptance criteria:** All API-603 tests pass.
**Blocked by:** API-603.
**Estimate:** S
**Notes (2026-06-26):** The three endpoints wired through the layers mirroring the API-602 progress impl (real route + service, port injected): `routes/library.ts` (edge validation + envelope) → new `services/library-service.ts` → injected `LibraryRepository` (the port already existed from API-603; no new port). `GET /api/library` lists the followed manga (`{ data: LibraryEntry[] }`, empty → `{ data: [] }`). `PUT /api/library/:mangaId` parses the JSON body with `express.json()` mounted locally on the route (kept off the body-parser-free routes), validates `addedAt` at the edge (missing/non-numeric → 400 before `add` is touched), and builds the `LibraryEntry` from **exactly** our two fields (`mangaId` from the URL, `addedAt` from the body) — any `deviceId` in the body is dropped here, never persisted (device-agnostic, RFC §7); follow is **idempotent** at the repository (re-follow keeps the original row). `DELETE /api/library/:mangaId` unfollows (no-op if absent), returning `{ data: { mangaId } }`. Implemented the concrete `SqliteLibraryRepository` (`src/adapters/db/library-repository.ts`) behind the API-603 port: a new `library` table (`manga_id` PK, `added_at`) added to the run-on-startup migrations; `add` is `INSERT OR IGNORE` (idempotent), `remove` a plain `DELETE`, `list` ordered by `added_at` (stable). The library router mounts whenever `libraryRepository` is wired in; composition root (`index.ts`) constructs `SqliteLibraryRepository` over the already-open DB. All 10 API-603 tests green; full suite 158 passing, lint + typecheck + format clean.

---

# Feature: Auth & Security (7xx)

> Single-user but multi-client. Applies across the whole API.

### API-701 — [TEST] Single-user auth middleware — **Done**
**Description:** Tests that all `/api/*` routes require a valid token/credential; missing/invalid → 401; valid passes through. Token scheme must not assume a single device.
**Acceptance criteria:**
- Protected route without credential → 401.
- Valid credential → handler runs.
- `/health` remains public.
**Blocked by:** API-105, API-103.
**Estimate:** M
**Notes (2026-06-27):** `test/http/auth.test.ts` drives the contract through Express with the app built by `createApp` (CLAUDE.md §4), mirroring the established endpoint-test pattern. **Scheme pinned:** `Authorization: Bearer <token>`, where the token is the single shared secret from `Config.auth.token` (already required in API-103). A bearer token in a header carries **no device identity** — any client presenting the secret is accepted — so the scheme is single-user but **multi-client** and does not assume one device (RFC §9/§13, CLAUDE.md §9/§10). The credential is injected via a new **optional** `authToken` on `AppDependencies` (kept optional so the existing `createApp` call sites stay valid; **API-702 mounts the middleware and reads it** — same red-test-that-executes pattern as the prior optional-dep tickets). Contract decisions (RFC §8 leaves shapes to impl): missing, wrong, malformed (non-`Bearer` scheme), or bare-token-without-scheme credentials → **401** with the standard `{ error: { code: "UNAUTHORIZED", message } }` envelope (the `UnauthorizedError` 401 type already exists in `http/errors.ts`), **rejected at the edge before any downstream port is touched**. A controllable `SuwayomiClient` (spies on `listSources`/`search`) lets each rejection assert the port was **not** reached, so a passing test genuinely proves auth short-circuits rather than the handler erroring. Coverage hits the three acceptance criteria — no credential → 401, valid Bearer → handler runs (200), `/health` public (200, no credential) — plus wrong/malformed/bare-token → 401, that **all** `/api/*` routes are guarded (a valid-param `/api/search` is 401 without a credential, so it's auth not validation), and the multi-client property (the same token accepted across two independent requests with no device id anywhere). **5 enforcement assertions fail red** (middleware unmounted — requests currently reach handlers) + **3 pass green** (valid token / multi-client / `/health`, which hold both before and after impl) pending API-702; existing 158 tests still pass (suite 166: 161 passing + 5 red), lint + typecheck + format clean.

### API-702 — Single-user auth middleware (impl) — **Done**
**Description:** Implement auth middleware satisfying API-701, applied globally to `/api/*`.
**Acceptance criteria:** All API-701 tests pass; credential sourced from config/secret, never hardcoded.
**Blocked by:** API-701.
**Estimate:** S
**Notes (2026-06-27):** Implemented `requireAuth(token)` (`src/http/auth.ts`), a middleware factory that compares the `Authorization` header against exactly `Bearer <token>` — missing, wrong, malformed (non-`Bearer` scheme), or bare-token-without-scheme all `next(new UnauthorizedError(...))` → 401 with the standard `{ error: { code: "UNAUTHORIZED", message } }` envelope (the existing `UnauthorizedError` + central error handler do the mapping), rejected at the edge before any feature router/port runs. A Bearer secret in a header carries no device identity, so the scheme is single-user but **multi-client** (RFC §13). Mounted in `createApp` on `/api` **after** the public `/health` route and **before** the feature routers, gated on `deps.authToken` (kept optional so the metadata-only `createApp` call sites in other tests stay valid). Composition root (`index.ts`) supplies `authToken: config.auth.token` — credential sourced from config (`AUTH_TOKEN`, already required + documented in `.env.example` since API-103), never hardcoded. All 8 API-701 tests green (the 5 previously-red enforcement assertions now pass); full suite 166 passing, lint + typecheck + format clean.

### API-703 — [TEST] Rate limiting — **Done**
**Description:** Tests for per-client rate limiting on API routes (limit, window, 429 on exceed).
**Acceptance criteria:**
- Requests over the limit in a window → 429.
- Limit/window configurable.
**Blocked by:** API-701.
**Estimate:** S
**Notes (2026-06-27):** `test/http/rate-limit.test.ts` drives the contract through Express with the app built by `createApp` (CLAUDE.md §4), mirroring the API-701 auth-test pattern (real route + handler, controllable upstream port). The limiter is injected via a new **optional** `rateLimit` on `AppDependencies` whose shape is pinned in a new `src/http/rate-limit.ts` `RateLimitOptions` contract (`{ limit, windowMs, clock?, clientKey? }`) — the `rateLimit()` middleware factory that consumes it lands in **API-704** (same red-test-that-executes-via-absence pattern as API-701: no middleware mounted yet, so requests reach handlers). Contract decisions (RFC §9, CLAUDE.md §9; §8 leaves shapes to impl): over the limit within a window → **429** with the standard `{ error: { code: "RATE_LIMITED", message } }` envelope, **rejected at the edge before the upstream port is touched** (a controllable `SuwayomiClient` spy lets the 429 assert `listSources` was reached only by the *allowed* requests — exactly `limit` times); **per-client** = counted per `clientKey(req)` defaulting to `req.ip` (a shared single-user token can't distinguish clients, so network identity does), with an injectable `clientKey` proving isolation deterministically (client A exhausted → 429 while client B → 200 in the same window, keyed off an `x-client-id` header to avoid trust-proxy gymnastics over loopback); **window expiry is deterministic** via an injectable `clock` (mirrors the session-cache clock — advance past `windowMs` and the allowance refreshes, no sleeping); the allowance is **shared across all `/api/*` routes** (a mix of `/api/sources` + `/api/search` draws on one count); and **`/health` is never rate-limited**. Coverage hits both acceptance criteria — over-limit → 429 (incl. envelope shape) and **limit configurable** (`it.each` 2 vs 5 → exactly that many allowed) plus **window configurable** (refresh after `windowMs`) — and the per-client + shared-allowance + `/health`-exempt properties. **6 enforcement assertions fail red** (over-limit, both configurable cases, window refresh, shared-across-routes, per-client — middleware unmounted, requests still 200) + **2 pass green** (allowed-up-to-limit and `/health` unmetered, which hold both before and after impl) pending API-704; existing 166 tests still pass (suite 174: 168 passing + 6 red), lint + typecheck + format clean.

### API-704 — Rate limiting (impl) — **Done**
**Description:** Implement rate limiting satisfying API-703.
**Acceptance criteria:** All API-703 tests pass.
**Blocked by:** API-703.
**Estimate:** S
**Notes (2026-06-27):** Implemented `rateLimit(options)` (`src/http/rate-limit.ts`), a middleware factory consuming the API-703 `RateLimitOptions` contract. A per-client **fixed-window counter** (`Map<clientKey, { count, startedAt }>`): the first request in a window stamps `startedAt`; subsequent requests within `windowMs` increment until `count >= limit`, when the next is rejected with a new `RateLimitedError` (429, `RATE_LIMITED`) added to `http/errors.ts` and mapped by the existing central error handler → `{ error: { code: "RATE_LIMITED", message } }`, rejected at the edge before any downstream port runs. `clock` defaults to `Date.now`, `clientKey` defaults to `req.ip` — a window resets once the clock has moved past `startedAt + windowMs`. Mounted in `createApp` on `/api` **before** auth + the feature routers, gated on the optional `deps.rateLimit` (so metadata-only call sites stay valid); `/health` (declared earlier, outside `/api`) stays unmetered. Configurable from new `Config.rateLimit` (`RATE_LIMIT` / `RATE_LIMIT_WINDOW_MS`, defaults 100 per 60 s, documented in `.env.example`); composition root passes it through. All 8 API-703 tests green (the 6 previously-red enforcement assertions now pass); full suite 174 passing, lint + typecheck + format clean.

---

# Feature: Deployment (8xx)

> Full Compose stack + public exposure. Done last; depends on the services existing.

### API-801 — API service in Compose — **Done**
**Description:** Add the Node API to `docker-compose.yml`: build, env/secrets, volumes (SQLite, CBZ store), `depends_on: suwayomi`, joined to the internal network.
**Acceptance criteria:**
- `docker compose up` brings up Suwayomi + API healthy.
- API reaches Suwayomi over the internal network.
- SQLite + CBZ volumes persist across restarts.
**Blocked by:** API-203, API-506, API-602, API-702.
**Estimate:** M
**Notes (2026-06-27):** Added the `api` service to `docker-compose.yml` plus a multi-stage `api/Dockerfile` (+ `.dockerignore`). The Dockerfile builds for the **container's** arch — the Mac Mini host is ARM (CLAUDE.md §13): a `deps` stage installs all deps with the `python3 make g++` toolchain better-sqlite3's native addon needs (sharp uses its prebuilt arm64 binaries), a `build` stage runs `npm run build`, a `prod-deps` stage does `npm ci --omit=dev` (native modules rebuilt for the runtime), and a slim `node:22-bookworm-slim` runtime copies `node_modules` + `dist` and adds `curl` for the healthcheck. The service: `build: ./api`, `depends_on: suwayomi { condition: service_healthy }` (the composition root opens a Suwayomi connection at startup, so it must wait), joined to the internal `komanga` network reaching Suwayomi by its in-network name (`SUWAYOMI_URL: http://suwayomi:4567`). `AUTH_TOKEN` comes from the host env via `${AUTH_TOKEN:?…}` so Compose **fails fast** if the secret is unset, never committed (CLAUDE.md §5/§9). Two named volumes persist our data, kept separate (RFC §7): `api-data` → `/data/db` (SQLite, `DATABASE_PATH=/data/db/komanga.sqlite`) and `cbz-store` → `/data/downloads` (persistent CBZ store, `CBZ_STORE_PATH`, separate from the ephemeral session cache). Published to **loopback only** (`127.0.0.1:3000:3000`) for local checks — the public entrypoint is the Cloudflare Tunnel (API-802) and loopback opens no inbound router ports (RFC §9). Container healthcheck curls `/health`.
**E2E verification (2026-06-27): PASS** (full `docker compose up` on the user-space Colima ARM daemon). Image built (better-sqlite3 compiled arm64, sharp prebuilt). **Both services healthy**, and the `depends_on: service_healthy` gate held — the API only started once Suwayomi passed its healthcheck. **Internal Suwayomi reach proven** end-to-end: `GET /api/sources` (Bearer auth) → 200 with live Suwayomi data (`Local source`) over the `komanga` network, while the same Suwayomi has **no host port** and `http://127.0.0.1:4567` is unreachable from the host (RFC §9); `/health` is public (200), `/api/sources` without a credential → 401 (API-702 auth applies). **Volume persistence proven across a container recreate** (`down` → `up`, named volumes): a `PUT /api/progress/99` write survived (`page: 42` read back from `api-data`/SQLite) and a sentinel file in `/data/downloads` survived (`cbz-store`). Lint + format clean; no app source changed (deploy-only ticket).

### API-802 — Cloudflare Tunnel connector — **Done**
**Description:** Add the `cloudflared` service pointing at the API; document tunnel + (optional) Cloudflare Access setup. No inbound router ports.
**Acceptance criteria:**
- API reachable over HTTPS via the tunnel hostname.
- Suwayomi is NOT reachable publicly.
- No inbound ports opened on the home router.
**Blocked by:** API-801, API-704.
**Estimate:** M
**Notes (2026-06-27):** Added the `cloudflared` service to `docker-compose.yml` as the stack's only public entrypoint (RFC §9/§10). It runs `tunnel --no-autoupdate run` against a **remotely-managed (token-based)** tunnel — the public hostname → service mapping lives in the Cloudflare Zero Trust dashboard, so there's no local config file. The connector dials **out** to Cloudflare's edge and proxies back to the API over the internal `komanga` network, so: **no `ports:` / no inbound router ports** (outbound-only, home IP hidden); **TLS terminated at the edge**; and **Suwayomi stays private** — cloudflared reaches only `api:3000` (the one ingress rule), Suwayomi has no published port and is not a tunnel target. `depends_on: api { condition: service_healthy }` so the first proxied request doesn't hit a cold upstream. The connector token is a secret from the host env via `${CLOUDFLARE_TUNNEL_TOKEN:?…}` (fail-fast, never committed, CLAUDE.md §5/§9). Added a root `.env.example` documenting the two Compose-level secrets (`AUTH_TOKEN`, `CLOUDFLARE_TUNNEL_TOKEN` — root `.env` is git-ignored) and `docs/cloudflare-tunnel.md` with the full one-time dashboard setup, hostname→`api:3000` route, verification steps, and the optional Cloudflare Access gate (incl. the service-token caveat for the Kobo/programmatic clients). `docker compose config` validates with the secrets set and **fails fast** when `CLOUDFLARE_TUNNEL_TOKEN` is unset. No app source changed (deploy-only ticket); image pins `cloudflare/cloudflared:latest` mirroring suwayomi's floating `:stable` tag.
**Live verification: PENDING (requires the user's Cloudflare account).** The compose wiring, config validation, and fail-fast are confirmed locally, but the "reachable over HTTPS via the tunnel hostname" criterion needs a real connector token + a zone in the user's Cloudflare Zero Trust dashboard, which can't be exercised from here. Once the token is in the root `.env` and the public hostname is mapped to `api:3000` (see `docs/cloudflare-tunnel.md`), `docker compose up -d` registers the connector and the three criteria are verifiable per that doc's "Verifying" section.

### API-803 — Smoke-test the full path end-to-end — **Done**
**Description:** Manual + scripted smoke test through the public tunnel: auth → search → manga → page (`eink`) → download → progress write/read.
**Acceptance criteria:**
- Every step succeeds through the public hostname with auth.
- `eink` page returns a processed image; `raw` returns source.
- Progress persists across two separate client sessions.
**Blocked by:** API-802.
**Estimate:** M
**Notes (2026-06-27):** Delivered both halves the ticket asks for. **Scripted:** `api/scripts/smoke-test.ts` (run via `npm run smoke`, new package script) drives the whole reading path against one configurable `BASE_URL` — meant for the public Cloudflare Tunnel hostname (the deployed surface), but works against the loopback `http://127.0.0.1:3000` (API-801) so the script can be validated without the tunnel. It walks every endpoint in order — `/health` (public) → `/api/sources` (asserts **missing + wrong credential → 401**, valid Bearer → 200) → `/api/search` → `/api/manga/:id` → `/api/chapter/:id/pages` → `/api/page/:id` under **both profiles** → `POST /api/chapter/:id/download` + `GET /api/downloads` + `GET /api/downloads/:id` → `PUT`/`GET /api/progress/:mangaId` — each carrying `Authorization: Bearer <AUTH_TOKEN>` (criterion #1). Criterion #2 is checked structurally with `sharp`: `raw` and `eink` bytes must **differ** (raw = lossless passthrough, eink = processed), the eink output must be **greyscale** (1-channel, or R/G/B means equal) and **fit within** the raw dimensions (resized-to-fit, never enlarged). Criterion #3 writes the position in one request and reads it back in a second **independent** request (separate client sessions, no shared state), asserting the identical position returns and that **no `deviceId`** is stored/echoed (device-agnostic, RFC §7). The CBZ is validated by its ZIP magic. Config via env (`BASE_URL`, `AUTH_TOKEN`, optional `SMOKE_SOURCE`/`SMOKE_QUERY`/`SMOKE_MANGA_ID`); non-zero exit + a clear `❌ step N` message on the first failure. To get the script type-checked + linted, `scripts` was added to `tsconfig.json`'s `include` (build still emits `src` only). **Manual:** `docs/smoke-test.md` documents the same path as a curl checklist and how to run the script; `docs/cloudflare-tunnel.md`'s Verifying section now points at it. Lint + typecheck + format + the full 174-test suite all clean (the script is an operational tool — it talks to live infra, so it is not part of the build or Vitest).
**Live verification (2026-06-27): PASS against the real stack** (Suwayomi v2.2.2100 `:stable` + the API container, brought up on the user-space Colima ARM daemon; ran `npm run smoke` from the host against the loopback-published `http://127.0.0.1:3000`). Only the `cloudflared` service was left down (its connector token is dashboard-bound to the user's Cloudflare account) — the API behind the tunnel is byte-identical, so only the public hostname + edge TLS (API-802's concern) go unexercised here. The Local source was empty, so I **seeded** a 4-page colour manga (1600×2200 JPEGs → `Smoke Test Manga/Chapter 1.cbz`, copied into the Suwayomi local volume; `fetchChapters` triggered once via Suwayomi's in-network GraphQL since our read-only API doesn't). **All 8 steps green:** auth (health public; missing **and** wrong credential → 401; valid → 200) → sources → search → manga+chapters (`readingDirection=rtl`) → page list (`1:0`…`1:3`) → **page profiles** (`raw` → `image/jpeg` 20969 B source passthrough; `eink` → `image/png` 7543 B, **greyscale**, **1053×1448 fitted within** the source 1600×2200 = resized-to-fit, never enlarged — criterion #2) → download (CBZ built, persisted, listed, served with a valid ZIP magic) → **progress across two separate sessions** (session A wrote ch1/page3, an independent session B read back the identical position, no `deviceId` stored — criterion #3). The live run **caught + fixed one script bug** (`getJson` eagerly read the response body inside the error-message template even on success → `res.json()` then failed "Body already read"; now the body is only consumed on failure). Lint + typecheck + format + the 174-test suite stay clean. **Still PENDING for the literal "public hostname" wording:** the run through the real Cloudflare hostname needs the user's account (same blocker as API-802) — once the tunnel is up, `AUTH_TOKEN='…' BASE_URL='https://<hostname>' npm run smoke` exercises the identical path through the edge.

---

# Feature: Bug Fixes / Device-spike reconciliation (9xx)

> Defects and contract-drift surfaced after the feature work, chiefly by the
> web-client **device capability spike** (`docs/device.md`). These reconcile the
> API with what the real Kobo was measured to do. Same strict-TDD rules apply.

### API-901 — [TEST] Constrain `eink` output format to device-renderable formats
**Description:** The `eink` image profile must only emit a format the target panel can decode. KWC-102 (`docs/device.md` §KWC-102) confirmed on the real Kobo Clara BW that the panel renders **PNG and JPEG** but **not WebP** (nor AVIF). RFC §6 already scopes the `eink` output to "PNG or low-chroma JPEG", but the config currently accepts `webp` as a valid `IMAGE_EINK_FORMAT` (`src/config/index.ts:4,6`) and the image-processor port's format type allows it (`src/services/ports/image-processor.ts`). Write failing tests that pin the allowed `eink` format set to `png | jpeg`.
**Acceptance criteria:**
- `loadConfig` **rejects** `IMAGE_EINK_FORMAT=webp` (and any non-`png`/`jpeg` value) with a clear aggregated error naming the allowed formats.
- `loadConfig` **accepts** `IMAGE_EINK_FORMAT=png` and `IMAGE_EINK_FORMAT=jpeg`; default stays `png`.
- Tests covering image processing / content-type that previously exercised `webp` as an `eink` format are updated to use `jpeg` (webp is no longer a valid `eink` output).
- Tests fail red against current code (which accepts `webp`).
**Surfaced by:** KWC-102 (web-client device spike).
**Blocked by:** none (fix to already-Done API-404 / config).
**Estimate:** S

### API-902 — Constrain `eink` output format (impl)
**Description:** Make API-901 pass. Remove `webp` from the allowed `eink` formats so a misconfiguration can't silently break the only client that uses the `eink` profile.
**Acceptance criteria:**
- All API-901 tests pass.
- `EinkFormat` / `EINK_FORMATS` (`src/config/index.ts`) and the image-processor port's eink `format` type are narrowed to `png | jpeg`; the `CONTENT_TYPES` map in `sharp-image-processor.ts` drops the `webp` entry.
- `.env.example` / any config docs mentioning `IMAGE_EINK_FORMAT` list only `png | jpeg`.
- Full suite, lint, typecheck, format clean.
- No change to the `raw` profile or to future colour-client paths (RFC §13) — only the `eink` output set is constrained.
**Blocked by:** API-901.
**Estimate:** S

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
9. **Bug fixes (9xx):** 901 → 902 (independent of the above; can be picked up any time)

> Note: Auth (7xx) only depends on the bootstrap layer, so it can be built early in parallel even though it's listed late. Everything funnels into API-801 for deployment.
> Note: 9xx are post-hoc fixes/reconciliations (e.g. from the device spike), not part of the original feature build order.

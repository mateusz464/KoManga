# TASKS — EPIC: Kobo Web Client

**Project:** KoManga
**Epic:** Kobo Web Client (the thin browser client running in Kobo's Nickel WebKit browser)
**Source of truth:** `RFC.md`
**Depends on epic:** API (consumes its REST endpoints)
**Conventions:** `CLAUDE.md` (to follow)

## Conventions for this list

- **ID scheme:** `KWC-NNN`. Hundreds block = feature (1xx Device Spike, 2xx Bootstrap/Build, 3xx App Shell & Networking, 4xx Browse & Search, 5xx Reader, 6xx Progress & Library, 7xx E-ink Polish & Hardening).
- **TDD:** strict where it makes sense. Logic (API client, state, pagination, cache hints) gets `[TEST]` tickets that block their impl. **Pure-visual / device-rendering work is validated on the real Kobo, not unit-tested** — those tickets carry a **[DEVICE]** tag and acceptance is a verified on-device check rather than a passing unit test.
- **Dependencies:** strict — a ticket cannot start until all `Blocked by` tickets are Done.
- **Estimates:** T-shirt (S / M / L).
- **Build philosophy:** write modern TS/JS, build down to old-WebKit-safe static assets (ES5-era target, inlined/minified). No runtime framework. Client served same-origin by the Node API.
- **Golden rule:** every feature is validated against the real device's constraints before being called Done. The monitor lies; the e-ink panel is the truth.

---

# Feature: Device Capability Spike (1xx)

> Must come first. Everything else is designed around what this finds. Throwaway code is fine — the deliverable is knowledge, captured in a doc.

### KWC-101 — [DEVICE] Identify target device & resolution
**Status:** Done
**Description:** Confirm the exact Kobo model, screen resolution, and Nickel browser version. Record the WebKit/user-agent string.
**Acceptance criteria:**
- Model, panel resolution, and UA string documented in `docs/device.md`.
- API image `eink` profile target resolution updated to match (cross-refs API config).
**Dependencies:** none.
**Estimate:** S
**Outcome:** Kobo Clara BW, fw 4.45.23697, panel 1072×1448 (WebKit 538.1). Recorded in `docs/device.md`. API `eink` target already 1072×1448 — matches, no change needed.

### KWC-102 — [DEVICE] JS/CSS capability probe
**Status:** Done
**Description:** Build a throwaway probe page that reports which JS/CSS features the Kobo browser supports (ES level, fetch vs XHR, flexbox/grid, CSS custom properties, `<img>` formats it renders, touch event model). Load it on-device.
**Acceptance criteria:**
- A capability report captured in `docs/device.md`: confirmed-supported vs must-avoid.
- Decisions recorded: fetch-or-XHR, layout method, supported image format(s), event model.
**Blocked by:** KWC-101.
**Estimate:** M
**Outcome:** Probe (`web-client/spike/kwc-102-capability-probe.html` + `serve_probe.py`) run on the real Clara BW (WebKit 538.1). Full capability report + the four decisions recorded in `docs/device.md` §KWC-102. Headlines: **pure ES5** (no ES2015 syntax or globals → ES5 target **plus polyfills**); **transport = XHR** (no `fetch`, no `URL`/`URLSearchParams`; `localStorage` ok); **layout = legacy `-webkit-box` flexbox** (no modern flex, no grid, no CSS custom properties; viewport is 732×762, not the 1072 panel); **images = PNG/JPEG/GIF render, WebP/AVIF do not** (API `eink` default `png` is safe — never set it to `webp` for this client); **events = Touch Events**, not Pointer. Unblocks KWC-201 (build target) and KWC-301 (transport).

### KWC-103 — [DEVICE] E-ink rendering & refresh behaviour probe
**Status:** Done
**Description:** Probe how the panel handles repaints: full vs partial refresh, ghosting, scroll vs paged navigation, tap responsiveness, image draw latency.
**Acceptance criteria:**
- Documented guidance: paged vs scroll, when to force full refresh, animation policy (almost certainly none), safe tap-target sizing.
- A recommended image format + size budget per page confirmed on-device.
**Blocked by:** KWC-101.
**Estimate:** M
**Outcome:** Refresh probe (`web-client/spike/kwc-103-refresh-probe.html` + `serve_refresh_probe.py`, recognizable stdlib-generated mock pages) run on the real Clara BW. Full guidance recorded in `docs/device.md` §KWC-103. Headlines: **paged, not scroll** — on-device, long-page scroll left content below the fold *unpainted* until a later scroll forced a repaint, so scroll is unsafe and every view must fit the 732×762 viewport and advance by explicit swaps; **force a full refresh on every view change & page turn** (the panel needs an explicit repaint trigger — centralised in `render/`); **no animation**; **tap targets** 32–88 px all register (≥44 px / large reader zones recommended; the timer caught hold-duration not latency); **image = PNG, soft budget ~1 MB/page** (~300 ms decode, rated instant — weight isn't the bottleneck, tunnel bandwidth is, so prefetch still matters). New device gotcha (scroll doesn't reliably paint) added to `web-client/CLAUDE.md` §12. Unblocks the refresh-policy work in KWC-307/505.

---

# Feature: Bootstrap & Build Pipeline (2xx)

> Set up the "write modern, ship ancient" pipeline. Output is static assets the API serves.

### KWC-201 — Project & build setup
**Status:** Done — all three criteria met, including verified on the real Clara BW.
**Description:** Initialise the client project: TS, a bundler (esbuild/Vite) configured to target old WebKit (ES5-era), minify, and emit static assets to a dist dir.
**Acceptance criteria:**
- `npm run build` emits static HTML/CSS/JS to a dist folder.
- Output transpiled to the target confirmed in KWC-102 (no untranspiled modern syntax in the bundle).
- A trivial page loads and runs on-device.
**Blocked by:** KWC-102.
**Estimate:** M
**Outcome:** Vanilla-TS client scaffolded (`web-client/`), strict TS, no framework. `npm run build` emits `dist/{index.html,main.js,styles.css}`.
- **Pipeline ("write modern, ship ancient"):** `scripts/build.mjs` runs **esbuild** (bundle TS + inlined polyfills → IIFE) → **Babel** `@babel/preset-env` (target IE11, an ES5 proxy) → **terser** (`ecma: 5`). esbuild alone was insufficient: its syntax floor is ES2015, so it *cannot* emit the pure ES5 KWC-102 requires — Babel does the actual down-levelling, terser caps the minifier at ES5.
- **Polyfills:** targeted core-js entry points imported explicitly in `src/polyfills.ts` (never wholesale) and bundled inline — auditable. Currently **Promise, Object.assign, Array.from, Array.includes**. (async/await/generators deliberately avoided for now; they'd need regenerator-runtime — noted in the build script for when first used.)
- **⚠️ Device finding — core-js global Symbol/Map/Set crash WebKit 538.1.** First on-device load threw `TypeError: Incompatible receiver, Symbol required` at polyfill *install* time: core-js's global `Symbol` module trips over the Kobo's partial/broken native Symbol. KWC-102 already lists Symbol/Map/Set as unsupported; the trivial page needs none of them, so they were dropped (75 KB → 48 KB bundle). **Do not blanket-import `core-js/stable/symbol|map|set` for this client** — recorded in `docs/device.md` §KWC-201 and `web-client/CLAUDE.md` §12. When a future ticket genuinely needs Map/Set/Symbol, use a Symbol-free/guarded approach and re-verify on-device.
- **ES5 verified two ways:** regex scan of `dist/main.js` finds zero `=>` / `const` / `let` / template-literal / `class` / spread / `await`; and the bundle **parses clean under acorn `ecmaVersion: 5`** (the definitive check).
- **On-device pass (real Clara BW, served over LAN):** renders "KoManga / Build pipeline OK — ES5 + polyfills (WebKit 538.1)" with Promise ✓, Object.assign ✓, Array.from ✓ — confirming both the ES5 transpile and the polyfills run on the panel. A temporary on-panel error-reporter (no device console) surfaced the Symbol crash and was removed once green.
- **Conventions:** legacy `-webkit-box` CSS (no grid/flex/custom-props), viewport sized to **732×762** (not the 1072 panel), no animations. Config mirrors the API epic (prettier/eslint/tsconfig house style).
- **Next:** same-origin serving (the path the device will really use) is **KWC-202** — have the Node API serve `dist/`.

### KWC-202 — Serve client from the API (same-origin)
**Status:** Done
**Description:** Have the Node API serve the built client as static files, same-origin, so the client can call `/api/*` without CORS. (Cross-refs API epic; coordinate the static-serving route.)
**Acceptance criteria:**
- Visiting the API's root over the tunnel serves the client.
- Client can call `/api/*` on its own origin with no CORS errors.
- `/health` and `/api/*` still behave as before.
**Blocked by:** KWC-201.
**Estimate:** S
**Outcome:** The API now serves the built `web-client/dist` same-origin (KWC-202).
- **Code (API epic):** `createApp` gained an optional `clientDir` dep; when set it mounts `express.static(clientDir)` **after** the `/api` routers (so it can never shadow an API route) and **before** the JSON 404 handler. Config exposes it as the optional `CLIENT_DIST_PATH` env (`src/config/index.ts` → `paths.clientDir`); the composition root passes it through. Unset = no static client (only `/health` + `/api/*`), preserving prior behaviour.
- **Same-origin = no CORS:** client and `/api/*` share one origin, so no CORS config is needed. The unauthenticated client HTML/JS/CSS load freely; only `/api/*` is auth-gated.
- **Tests:** `api/test/http/client-static.test.ts` — root serves `index.html`, static assets serve, `/health` unchanged, the static mount doesn't shadow the `/api` 404 envelope, and no-`clientDir` falls through to JSON 404. Full API suite (181) + typecheck + lint clean.
- **Verified running:** booted the API against the real `../web-client/dist` — `GET /` → 200 `text/html` (the actual Clara BW client HTML), `/main.js` → `text/javascript`, `/styles.css` → `text/css`, `/health` → `{"status":"ok"}`, `/api/*` still 401 without the token.
- **Deployment:** `docker-compose.yml` bind-mounts `./web-client/dist:/web-client:ro` and sets `CLIENT_DIST_PATH=/web-client` (build the client on the host first); documented in `api/.env.example`.

### KWC-203 — [TEST] Test setup for client logic
**Status:** Done
**Description:** Add a test runner for the non-visual logic (API client, state, helpers) with DOM/fetch mocking.
**Acceptance criteria:**
- `npm test` runs; a trivial logic test passes.
- A documented pattern exists for testing modules without a real browser.
**Blocked by:** KWC-201.
**Estimate:** S
**Outcome:** **Vitest** wired up for client logic, mirroring the API epic's house style.
- **Config (`vitest.config.ts`):** `environment: "jsdom"` (gives DOM-touching code and `XMLHttpRequest` a browser-shaped sandbox off-device — visual correctness stays a `[DEVICE]` check, never asserted here), `globals: true`, tests under `test/**/*.test.ts` mirroring `src/`. As in the API epic, tests still import `describe`/`it`/`expect`/`vi` from `"vitest"` explicitly so type-check and lint stay clean.
- **Scripts:** `npm test` (`vitest run`) + `npm run test:watch`. `tsconfig.json` `include` now covers `test` so test files are type-checked.
- **Deps:** added `vitest` + `jsdom` (dev).
- **Trivial test (`test/smoke.test.ts`):** passes — arithmetic, jsdom DOM presence, and a `vi.fn` boundary-mock example. `test/README.md` documents the off-device patterns: **mock the network at the `api/` boundary** (inject a stubbed client; drop to the `XMLHttpRequest` layer only when testing the API client itself in KWC-301), and jsdom for DOM-touching logic.
- **Verified:** `npm test` green (3 passing), `typecheck` / `lint` / `format:check` all clean; `npm run build` unaffected.
- **Next:** unblocks the first logic suites — KWC-301 (API client tests) and KWC-305 (router tests).

---

# Feature: App Shell & Networking (3xx)

> The skeleton: a typed API client, auth handling, routing between views, and a global e-ink-aware render approach.

### KWC-301 — [TEST] API client module
**Status:** Done
**Description:** Tests for a typed client wrapping the API endpoints (sources, search, manga, pages, page image URL builder with `profile`, downloads, progress, library), including auth header injection and error mapping. Uses the capability-confirmed transport (fetch or XHR).
**Acceptance criteria:**
- Tests cover request shaping, auth header, and error/non-200 handling per endpoint.
- Page-image URL builder always requests `profile=eink`.
**Blocked by:** KWC-203.
**Estimate:** M
**Outcome:** Red-phase contract suite for the typed `ApiClient` in place (`web-client/test/api/client.test.ts`, 25 tests), with the surface it pins down stubbed so the suite compiles and runs but fails until KWC-302:
- **Module surface (KWC-302 implements):** `src/api/client.ts` (`ApiClient` + `ApiClientOptions { baseUrl?, getToken? }`, every method a red-phase reject/throw "not implemented yet — see KWC-302"), `src/api/types.ts` (client-owned domain types, mapped from the API's `{ data }` envelope — not imported from the API epic), `src/api/errors.ts` (`ApiClientError {status, code}`, `UnauthorizedError` (401), `NetworkError` (status 0) — typed so views/state branch without string-matching).
- **Transport boundary = XHR, mocked at the `XMLHttpRequest` layer** (per `test/README.md` — the boundary drops one level for this module only). A `FakeXhr` installed on `globalThis.XMLHttpRequest` records `open`/`setRequestHeader`/`send` and drives the response (or a network error) on a microtask, so tests assert the *actual* request the client shapes. Confirms the spike's transport choice: **no `fetch`, no `URL`/`URLSearchParams`** — the suite parses query strings by hand and expects the client to too.
- **Coverage (acceptance):** per-endpoint request shaping — `GET /sources`, `GET /search?q&source&page`, `GET /manga/:id`, `GET /chapter/:id/pages`, `POST /chapter/:id/download?mangaId&profile=eink`, `GET /downloads`, `GET|PUT /progress/:mangaId`, `GET /library`, `PUT|DELETE /library/:mangaId`; method + hand-built/encoded URL + JSON body/content-type asserted. **Auth header** — `Authorization: Bearer <token>` attached when `getToken()` returns one, omitted when null, **read per request** (a later login is picked up). **Error/non-200 mapping** — 401→`UnauthorizedError`, 404/502→`ApiClientError` carrying envelope `status`+`code`, unparseable error body still maps by status, transport failure→`NetworkError`. **Page-image URL builder always pins `profile=eink`** (never `raw`), id percent-encoded, honours `baseUrl`.
- **Red verified:** all 25 fail solely on the missing KWC-302 impl (20 throw "not implemented", 5 error-mapping cases catch the stub's generic `Error` and fail the typed `instanceof`); the 3 KWC-203 smoke tests still pass. `typecheck` / `lint` / `format:check` all clean.
- **Next:** KWC-302 implements the XHR transport, hand-rolled query/path encoding, auth injection and error mapping to turn this suite green.

### KWC-302 — API client module (impl)
**Status:** Done
**Description:** Implement the API client satisfying KWC-301.
**Acceptance criteria:** All KWC-301 tests pass.
**Blocked by:** KWC-301.
**Estimate:** M
**Outcome:** `ApiClient` implemented — all 25 KWC-301 contract tests green (28 total with the smoke suite); typecheck / lint / format:check / build all clean. Split into single-purpose modules under `src/api/` (CLAUDE.md §5/§9) rather than one file — the build bundles all of `src/` into a single `main.js` anyway, so source-level modularity is free on-device:
  - `url.ts` — hand-rolled URL/query construction (`encodeToken`, `buildQuery`, `buildUrl`); the "no `URL`/`URLSearchParams`" detail (KWC-102) lives here. Pure.
  - `envelope.ts` — `unwrap` (`{ data }`) + `mapError` (`{ error }`). Pure.
  - `http.ts` — `HttpClient`: the ONLY place XHR lives; XHR mechanics + per-request auth injection, delegating to url.ts + envelope.ts.
  - `client.ts` — `ApiClient`: just the typed endpoint surface, delegating to `HttpClient`.
- **Transport = hand-rolled XHR** (no `fetch`): `HttpClient.request<T>()` opens an `XMLHttpRequest`, resolves on `onload` for 2xx and rejects via `onerror` for transport failure.
- **Hand-built query strings** (`buildQuery`): keys + values `encodeURIComponent`-encoded, `undefined` values dropped so optional params (search `page`) vanish on the first page. Path segments encoded via `encodeToken()` (`m/1`→`m%2F1`, `c1:5`→`c1%3A5`).
- **Auth read per request:** `getToken()` is called inside `request()` each time, so a later login is picked up; `Authorization: Bearer <token>` attached only when a token is returned, omitted on null.
- **Envelope handling:** success unwraps `{ data }`; non-2xx maps via `mapError` — `401`→`UnauthorizedError`, other statuses→`ApiClientError` carrying the envelope `status`+`code`, an unparseable error body still maps by status (code `UNKNOWN`), transport failure→`NetworkError` (status 0).
- **URL builders are pure:** `pageImageUrl` always pins `profile=eink` (never `raw`, carries no auth — it's an `<img>` src); `downloadCbzUrl` builds the stored-CBZ path. Both honour `baseUrl` (default `""` for same-origin, KWC-202) via `HttpClient.url()`.
- **Note:** ES5/on-device verification rides the KWC-201 pipeline (esbuild→Babel→terser); `ApiClient` is wired into `main.ts` by the view/state tickets that consume it — `npm run build` already succeeds.
- **Next:** unblocks KWC-303/304 (auth flow), KWC-401/403/501/603 (logic suites that mock at this boundary).

### KWC-303 — [TEST] Auth flow (single credential)
**Status:** Done
**Description:** Tests for entering/storing the single-user credential and attaching it to every request; handling 401 by returning to the credential prompt.
**Acceptance criteria:**
- Credential persists across reloads (storage mechanism confirmed available on-device).
- 401 from any call routes back to the credential entry view.
**Blocked by:** KWC-301.
**Estimate:** S
**Outcome:** Red-phase contract suite for the auth flow in place (`web-client/test/state/auth.test.ts`, 13 tests), with the surface it pins down stubbed so the suite compiles and runs but fails until KWC-304:
- **Module surface (KWC-304 implements):** `src/state/auth.ts` — `AuthController` (one credential for the whole client) with `AuthControllerOptions { storage?, onRequireLogin? }`, methods `getToken()` / `isAuthenticated()` / `login(token)` / `logout()` / `handleApiError(error): boolean`, plus the exported `CREDENTIAL_STORAGE_KEY` and an injectable `CredentialStorage` interface. Every method throws "not implemented yet — see KWC-304" (the constructor is a no-op so tests fail on their real assertions, not at setup). Lives in `state/` (framework-free, testable) — not `api/`, since the ApiClient already takes `getToken` as a callback (KWC-302) and only `api/` touches XHR.
- **Storage = localStorage, the only persistence the spike confirmed on-device (KWC-102).** Injectable via the `CredentialStorage` boundary (the `getItem`/`setItem`/`removeItem` slice of Web Storage) so persistence is asserted deterministically with an in-memory double; one test checks the real default is the browser's `localStorage` (jsdom supplies it). **Persistence across reloads** is modelled as a fresh `AuthController` over the same storage reading the credential back. Namespaced key `komanga.credential` so it never collides in the same-origin store (KWC-202).
- **Coverage (acceptance):** *persistence* — empty storage → unauthenticated/null token; `login` exposes the token + writes under the key; survives a "reload"; reads a pre-existing credential at construction; `logout` clears storage; default-localStorage path. *getToken for the ApiClient* — the `() => auth.getToken()` callback the shell wires is read per request, so a later `login` is picked up (matches KWC-302's per-request auth read). *401 routing* — `handleApiError(UnauthorizedError)` clears the credential, fires `onRequireLogin` once, returns `true`; a non-401 `ApiClientError` (502) and a transport `NetworkError` both leave the credential intact, don't fire `onRequireLogin`, return `false` (offline ≠ unauthorised); a non-error value is ignored without throwing. *End-to-end* — a real `ApiClient.listSources()` driven to 401 via a `FakeXhr` rejects with the actual `UnauthorizedError`, which `handleApiError` then routes back — proving the "from ANY call" criterion against the real transport error, not a hand-built one.
- **Red verified:** all 13 fail solely on the missing KWC-304 impl ("not implemented yet — see KWC-304"); the prior 28 (KWC-301 client + KWC-203 smoke) still pass. `typecheck` / `lint` / `format:check` / `build` all clean.
- **Next:** KWC-304 implements `AuthController` (localStorage read/write, token exposure, 401→logout+route) to turn this suite green, then verified on-device.

### KWC-304 — Auth flow (impl)
**Status:** Done (logic) — all 13 KWC-303 tests green; on-device credential-entry pass deferred to KWC-307 (no UI shell exists yet).
**Description:** Implement credential entry/storage satisfying KWC-303.
**Acceptance criteria:** All KWC-303 tests pass; verified on-device.
**Blocked by:** KWC-303, KWC-302.
**Estimate:** S
**Outcome:** `AuthController` implemented in `src/state/auth.ts` — all 13 KWC-303 contract tests pass (41 total with the KWC-301 client + smoke suites); typecheck / lint / format:check / build all clean.
- **Storage:** the injected `CredentialStorage` (defaulting to the browser's `localStorage`, the only persistence the spike confirmed on-device — KWC-102). All four state methods are thin reads/writes of the namespaced `komanga.credential` key — no in-memory mirror of the token, so the store is the single source of truth and **persistence across reloads is automatic** (a fresh `AuthController` over the same storage reads the credential straight back). `getToken()` is read live each call, so the `() => auth.getToken()` callback the shell wires into `new ApiClient` (KWC-302) picks up a later `login` without rebuilding anything.
- **401 routing:** `handleApiError` keys off `instanceof UnauthorizedError` (the typed error the transport produces — KWC-302), so it routes back on a 401 from *any* call. On a match it `logout()`s and fires `onRequireLogin` once, returning `true`; everything else — a non-401 `ApiClientError` (e.g. 502), a transport `NetworkError` (offline ≠ unauthorised), or a non-error value — returns `false` and leaves the credential intact. The end-to-end test drives a real `ApiClient.listSources()` to a 401 via a `FakeXhr` and confirms the resulting `UnauthorizedError` flows through `handleApiError` back to the prompt.
- **On-device:** the storage primitive (`localStorage`) is already spike-verified on the Clara BW (KWC-102); the *credential-entry UX* on-device acceptance is deferred to **KWC-307** (app shell), which builds the entry view, wires `onRequireLogin`, and is itself a `[DEVICE]` ticket. No on-device-renderable surface exists in this ticket to validate independently.
- **Next:** unblocks KWC-307 (app shell wires `AuthController` + the credential entry view and does the on-device pass).

### KWC-305 — [TEST] View router
**Status:** Done
**Description:** Tests for a minimal router switching between views (library, search, manga details, reader) without a framework — hash or state based.
**Acceptance criteria:**
- Navigating between views updates state correctly; back navigation works.
- No full reloads between views.
**Blocked by:** KWC-203.
**Estimate:** S
**Outcome:** Red-phase contract suite for the view router in place (`web-client/test/router/router.test.ts`, 18 tests), with the surface it pins down stubbed so the suite compiles and runs but fails until KWC-306:
- **Module surface (KWC-306 implements):** split like `api/` is — `src/router/routes.ts` holds the **pure** fragment↔`Route` serialization (`Route` union for the four views — `library` / `search{query?,source?}` / `manga{mangaId}` / `reader{mangaId,chapterId}` — plus `routeToHash` / `parseHash`, both throwing "not implemented yet — see KWC-306"); `src/router/router.ts` holds the stateful `Router` (`start` / `stop` / `current` / `navigate` / `replace` / `back` / `subscribe`, all throwing the same), taking the window/history/hashchange surface as an injected `RouterEnvironment` (`getHash` / `pushHash` / `replaceHash` / `back` / `subscribe`). DI mirrors `auth.ts`'s `CredentialStorage` so the logic is testable off-device.
- **Transport choice honoured (KWC-102):** routes serialize by hand — **no `URL`/`URLSearchParams`** — so the suite asserts the literal hand-built query (`#/search?q=one%20piece&source=mangadex`, absent params omitted) and percent-encoded Suwayomi-style ids carrying `/` and `:` (`#/manga/src1%2Fmanga%3A42`), with a round-trip property test.
- **Coverage (acceptance):** *navigation updates state* — `current()` tracks each `navigate()` across all four views; subscribers + the `onChange` option fire (once per change). *Back works* — a `FakeEnvironment` with a real back-stack drives `router.back()` to the previous view, and a **physical** browser back (an outside fragment change) is picked up too, proving the router reacts to the history surface, not only its own calls. *No full reloads* — every `routeToHash` is `#`-prefixed and `navigate` only mutates the fragment (asserted via the env's hash). Plus `replace()` adds no history entry (`back()` skips it), `parseHash` falls back to `library` for empty/unknown fragments, and `subscribe` unsubscribe / `stop()` detach the listeners.
- **Red verified:** all 18 fail solely on the missing KWC-306 impl ("not implemented yet — see KWC-306"); the prior 41 (KWC-301 client + KWC-303 auth + KWC-203 smoke) still pass. `typecheck` / `lint` / `format:check` all clean.
- **Next:** KWC-306 implements `routes.ts` (hand-rolled serialization) + `Router` (a `RouterEnvironment` over `window`, fragment as single source of truth, dedupe of the echo from its own `pushHash`) to turn this suite green.

### KWC-306 — View router (impl)
**Status:** Done — all 18 KWC-305 tests green (59 total); typecheck / lint / format:check / build all clean.
**Description:** Implement the router satisfying KWC-305.
**Acceptance criteria:** All KWC-305 tests pass.
**Blocked by:** KWC-305.
**Estimate:** S
**Outcome:** Router implemented across the two stubbed modules, split exactly as KWC-305 pinned down:
- **`src/router/routes.ts` (pure serialization):** `routeToHash` switches over the four-view discriminated union — `#/library`, `#/search` + hand-built query, `#/manga/<enc>`, `#/reader/<enc>/<enc>` — with ids/values `encodeURIComponent`-encoded. `parseHash` peels the leading `#`, splits the query at `?`, strips the leading `/`, then dispatches on the first path segment; empty/unknown/`#`/`#/` all fall back to `library` so the app always lands somewhere valid. Query string is hand-rolled both ways (`buildSearchQuery` / `parseQuery`) — **no `URL`/`URLSearchParams`** (KWC-102) — omitting absent params and round-tripping `/` and `:` in Suwayomi-style ids.
- **`src/router/router.ts` (stateful):** the fragment is the single source of truth. `navigate()` only pushes a new hash; the environment's change event drives `syncFromFragment()`, which re-reads the hash, updates `current()`, and notifies — so programmatic navigation and physical browser back/forward share one path. `replace()` calls `replaceHash` (no history entry, fires no event, mirroring `history.replaceState`) and syncs directly. `start()` is idempotent, subscribes to the environment, and emits the initial route once (covering the `onChange` option, wired as a subscriber at construction); `stop()` detaches. `back()` delegates to the environment.
- **DI mirrors `auth.ts`:** the window/history/hashchange surface is the injected `RouterEnvironment`; the default `createWindowEnvironment()` wraps `window.location`/`history`/`hashchange` (never hit by the off-device tests, which drive a deterministic back-stack fake).
- **ES5 / on-device safety (CLAUDE.md §12):** subscribers are a **plain array** (not a `Set`) iterated with an index loop over a `slice()` copy — no `Set`/`Symbol`/iterator-spread, which this WebKit's broken native `Symbol` + the core-js polyfill crash on. Authored modern (arrow callbacks); the build (esbuild→Babel→terser) down-levels it — `dist/main.js` scans clean of `=>`/`const`/`let`/template-literal/`class`/spread.
- **Next:** unblocks KWC-307 (app shell wires the `Router` + `AuthController` + credential-entry view and does the on-device pass).

### KWC-307 — [DEVICE] App shell & e-ink render policy
**Status:** Built & verified off-device — **on-device acceptance pending the real Clara BW** (it's a `[DEVICE]` ticket; the two criteria below are on-panel judgements that can't be asserted off-hardware). Everything buildable is done: typecheck / lint / format:check clean, all 59 logic tests still green, `npm run build` emits the ES5 bundle (acorn `ecmaVersion:5` parse clean), and the built bundle drives the full shell flow correctly in jsdom.
**Description:** Build the base layout (tap-based nav, large targets, no animation) and a central render helper that applies the refresh policy from KWC-103.
**Acceptance criteria:**
- Shell renders cleanly on-device with no ghosting on view changes.
- Tap targets meet the sizing guidance; navigation feels responsive on e-ink.
**Blocked by:** KWC-306, KWC-304, KWC-103, KWC-202.
**Estimate:** M
**Outcome:** App shell + central e-ink render policy built, wiring the framework-free pieces (AuthController, Router, render/) together per CLAUDE.md §5.
- **`src/render/` — the ONE place the refresh policy lives (CLAUDE.md §5/§7/§12, KWC-103).** `refresh.ts`: `renderView(root, build)` builds a view off the live tree, swaps it in as the container's sole child in one operation (one repaint, not many), then calls `forceFullRefresh()` — a synchronous display-off→reflow→on toggle that gives this Nickel/WebKit build the explicit repaint trigger it needs on a view change (the spike saw content stay unpainted otherwise). No timers/transitions: a stepped black→white flash was deliberately rejected (it needs a frame yield = animation, which the no-animation rule forbids), and the spike rated in-place in-viewport swaps clean. `dom.ts`: `el()` / `tapButton()` / `clearChildren()` — the only DOM-building helpers; `tapButton` binds a `click` (Nickel synthesises it from a tap; keeps the shell usable on desktop too).
- **Shell (`src/main.ts`):** persistent tap-nav bar (Library / Search, large targets) + a `#content` region the router swaps views into. **Auth-gated render** — until a credential is stored it shows the login view (nav hidden); `AuthController.onRequireLogin` (a 401 from any later call) drops back to it. The **reader route renders full-screen** (nav hidden); every other view keeps the nav. `router.start()` emits the initial route, which paints through `renderView`.
- **Credential entry (`src/views/login.ts`)** — the on-device credential-entry surface **KWC-304 deferred here**. Enter → `AuthController.login(token)` (localStorage, KWC-304) → re-render the current route, now authenticated.
- **Placeholders (`src/views/placeholder.ts`)** stand in for library/search/manga/reader so the nav + refresh policy are demonstrable now; each feature ticket (4xx/5xx/6xx) replaces its stub. **ApiClient is not instantiated here** — the consuming view tickets wire it with `getToken: () => auth.getToken()` (KWC-302).
- **`src/config.ts`** — central client config (`apiBaseUrl: ""` same-origin per KWC-202; `prefetchWindow` for KWC-503).
- **CSS** — shell is a fixed 732×762 non-scrolling `-webkit-box` column (KWC-103: scroll is unsafe — views fit the viewport and swap in place); 72 px nav tap targets (≥ 44 px guidance), high contrast, no transitions/animations.
- **Off-device verification:** the built `dist/main.js` run in jsdom drives the whole flow — first launch → login (nav hidden) → submit stores `komanga.credential` → Library renders with nav → tap Search/Library navigate hash-only (no reload) → reader route hides the nav → physical `history.back()` returns to the prior view.
- **Remaining (the `[DEVICE]` gate):** load on the real Clara BW (via the API serving `dist/` same-origin, KWC-202) and confirm clean render / no ghosting on view changes and responsive tap nav. No new device findings, so `docs/device.md` is unchanged.
- **Next:** unblocks KWC-402 / 404 / 604 (feature views render into this shell) and the reader chain.

---

# Feature: Browse & Search (4xx)

> Source list, search, manga details + chapter list. Metadata only — no page images yet.

### KWC-401 — [TEST] Source list & search views (logic)
**Description:** Tests for the logic behind listing sources and rendering search results (state, pagination/"load more", empty/error states) against the mocked API client.
**Acceptance criteria:**
- Search submits query + source; results populate state; empty + error states handled.
- Pagination/load-more advances correctly.
**Blocked by:** KWC-302.
**Estimate:** M

### KWC-402 — Source list & search views (impl)
**Description:** Implement the source/search UI satisfying KWC-401.
**Acceptance criteria:** All KWC-401 tests pass.
**Blocked by:** KWC-401, KWC-307.
**Estimate:** M

### KWC-403 — [TEST] Manga details & chapter list view (logic)
**Description:** Tests for the manga details view: details, ordered chapter list, follow/unfollow action, and surfacing reading direction + last-read position.
**Acceptance criteria:**
- Chapter list renders in correct order; last-read chapter is indicated.
- Follow/unfollow toggles state and calls the API.
**Blocked by:** KWC-302.
**Estimate:** M

### KWC-404 — Manga details & chapter list view (impl)
**Description:** Implement the manga details UI satisfying KWC-403.
**Acceptance criteria:** All KWC-403 tests pass.
**Blocked by:** KWC-403, KWC-307.
**Estimate:** M

### KWC-405 — [DEVICE] Browse/search on-device pass
**Description:** Validate the full browse path on the Kobo: image thumbnails (cover art via `eink` profile), text legibility, scroll/paging through results.
**Acceptance criteria:**
- Covers and text render legibly; no broken layout on the real panel.
- Result paging is usable without excessive ghosting.
**Blocked by:** KWC-402, KWC-404.
**Estimate:** M

---

# Feature: Reader (5xx)

> The core experience. Page streaming, prefetch-aware navigation, reading direction, image presentation tuned for e-ink.

### KWC-501 — [TEST] Reader state & page navigation (logic)
**Description:** Tests for reader state: current page index, next/prev navigation, chapter boundaries (last page → next chapter), respecting reading direction (RTL/LTR), and requesting pages by ID + `eink` profile.
**Acceptance criteria:**
- Next/prev moves correctly; RTL reverses tap zones appropriately.
- Reaching the last page offers/loads the next chapter.
- Page requests use the `eink` profile.
**Blocked by:** KWC-302.
**Estimate:** L

### KWC-502 — Reader navigation (impl)
**Description:** Implement reader navigation/state satisfying KWC-501.
**Acceptance criteria:** All KWC-501 tests pass.
**Blocked by:** KWC-501.
**Estimate:** M

### KWC-503 — [TEST] Client-side prefetch hinting
**Description:** Tests that the reader requests upcoming pages ahead of display (complementing server prefetch) so the next page is ready on tap, bounded by a configurable window.
**Acceptance criteria:**
- Viewing page N triggers fetch of the next page(s) within the window.
- Already-fetched pages display without a new network round-trip.
**Blocked by:** KWC-501.
**Estimate:** M

### KWC-504 — Prefetch hinting (impl)
**Description:** Implement client prefetch satisfying KWC-503.
**Acceptance criteria:** All KWC-503 tests pass.
**Blocked by:** KWC-503.
**Estimate:** M

### KWC-505 — [DEVICE] Page presentation & tap zones
**Description:** Build the actual page display: fit image to panel, define tap zones (prev/next/menu), apply the no-animation refresh policy. Tune against the eink-processed images.
**Acceptance criteria:**
- A page fills the panel correctly with no distortion; RTL/LTR tap zones correct.
- Page turns feel responsive; minimal/controlled ghosting (full refresh where needed).
- Validated across a multi-page chapter on-device.
**Blocked by:** KWC-502, KWC-504, KWC-103.
**Estimate:** L

### KWC-506 — [DEVICE] Reader menu & loading/error states
**Description:** Add an in-reader menu (chapter list, page jump, download-this-chapter action) and on-device-legible loading/error/retry states for slow or failed page fetches.
**Acceptance criteria:**
- Menu opens/closes without disrupting reading position.
- Slow/failed page shows a clear loading/retry state, not a blank panel.
- "Download chapter" triggers the API download endpoint and reflects status.
**Blocked by:** KWC-505.
**Estimate:** M

---

# Feature: Progress & Library (6xx)

> Wire the reader to server-side progress sync and the library view.

### KWC-601 — [TEST] Progress sync (logic)
**Description:** Tests that turning a page updates progress to the API (debounced), and that opening a manga resumes from the stored last-read position. Last-write-wins.
**Acceptance criteria:**
- Page turns push progress (debounced, not every tap hammering the API).
- Reopening a manga resumes at the synced position.
**Blocked by:** KWC-502.
**Estimate:** M

### KWC-602 — Progress sync (impl)
**Description:** Implement progress sync satisfying KWC-601.
**Acceptance criteria:** All KWC-601 tests pass; verified resuming across two sessions on-device.
**Blocked by:** KWC-601, KWC-506.
**Estimate:** S

### KWC-603 — [TEST] Library view (logic)
**Description:** Tests for the library/home view: followed manga, resume-reading shortcuts, downloaded chapters list.
**Acceptance criteria:**
- Followed manga + last-read position render; "continue reading" jumps into the reader.
- Downloaded chapters are listed and openable.
**Blocked by:** KWC-302.
**Estimate:** M

### KWC-604 — Library view (impl)
**Description:** Implement the library view satisfying KWC-603.
**Acceptance criteria:** All KWC-603 tests pass.
**Blocked by:** KWC-603, KWC-307.
**Estimate:** M

---

# Feature: E-ink Polish & Hardening (7xx)

> Final pass once the app works end-to-end. Real-device tuning, resilience, and entry-point niceties.

### KWC-701 — [DEVICE] Typography & contrast tuning
**Description:** Tune fonts, sizes, weights, and contrast for e-ink legibility across all views on the real panel.
**Acceptance criteria:**
- Text is comfortably legible on-device across views.
- Settled values documented in `docs/device.md`.
**Blocked by:** KWC-604, KWC-506.
**Estimate:** M

### KWC-702 — Network resilience & offline downloaded reading
**Description:** Handle flaky/lost connectivity gracefully and allow reading already-downloaded chapters when the network is unavailable.
**Acceptance criteria:**
- Dropped connection shows a clear state and retry, never a hard crash.
- A previously downloaded chapter opens and reads with the network off.
**Blocked by:** KWC-506, KWC-604.
**Estimate:** M

### KWC-703 — [DEVICE] Add-to-home / launch experience
**Description:** Make launching from the Kobo as smooth as the browser allows (bookmark/home-screen entry, sensible landing view, fast first paint).
**Acceptance criteria:**
- A documented one-tap way to open the app on-device.
- First view after launch is the library/home, loading acceptably.
**Blocked by:** KWC-701.
**Estimate:** S

### KWC-704 — [DEVICE] Full end-to-end on-device acceptance
**Description:** Full journey on the real Kobo through the public tunnel: auth → search → follow → read (streamed) → download → read downloaded → resume across a session.
**Acceptance criteria:**
- Every step succeeds on-device over the tunnel.
- Streamed reading and downloaded reading both work; progress resumes correctly.
- No blocking legibility or refresh issues remain.
**Blocked by:** KWC-702, KWC-703.
**Estimate:** M

---

## Suggested build order (respecting strict deps)

1. **Spike first:** KWC-101 → 102 / 103. *Do not start 2xx until the capability report exists.*
2. **Pipeline:** KWC-201 → 202 / 203.
3. **Shell & networking:** 301→302, 303→304, 305→306 → 307.
4. **Browse:** 401→402, 403→404 → 405 (device pass).
5. **Reader:** 501→502, 503→504 → 505 → 506.
6. **Progress & library:** 601→602, 603→604.
7. **Polish:** 701 → 703, 702, → 704 (final acceptance).

> Notes:
> - **The spike gates everything.** Build target (KWC-201), transport choice (KWC-301), and refresh policy (KWC-307/505) all consume its output. Don't shortcut it.
> - `[DEVICE]` tickets are validated on the real Kobo, not by unit tests — the acceptance criteria reflect that.
> - This epic assumes the matching API endpoints exist; coordinate KWC-202 (static serving) with the API epic's deployment tickets.

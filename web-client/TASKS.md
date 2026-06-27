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
**Description:** Probe how the panel handles repaints: full vs partial refresh, ghosting, scroll vs paged navigation, tap responsiveness, image draw latency.
**Acceptance criteria:**
- Documented guidance: paged vs scroll, when to force full refresh, animation policy (almost certainly none), safe tap-target sizing.
- A recommended image format + size budget per page confirmed on-device.
**Blocked by:** KWC-101.
**Estimate:** M

---

# Feature: Bootstrap & Build Pipeline (2xx)

> Set up the "write modern, ship ancient" pipeline. Output is static assets the API serves.

### KWC-201 — Project & build setup
**Description:** Initialise the client project: TS, a bundler (esbuild/Vite) configured to target old WebKit (ES5-era), minify, and emit static assets to a dist dir.
**Acceptance criteria:**
- `npm run build` emits static HTML/CSS/JS to a dist folder.
- Output transpiled to the target confirmed in KWC-102 (no untranspiled modern syntax in the bundle).
- A trivial page loads and runs on-device.
**Blocked by:** KWC-102.
**Estimate:** M

### KWC-202 — Serve client from the API (same-origin)
**Description:** Have the Node API serve the built client as static files, same-origin, so the client can call `/api/*` without CORS. (Cross-refs API epic; coordinate the static-serving route.)
**Acceptance criteria:**
- Visiting the API's root over the tunnel serves the client.
- Client can call `/api/*` on its own origin with no CORS errors.
- `/health` and `/api/*` still behave as before.
**Blocked by:** KWC-201.
**Estimate:** S

### KWC-203 — [TEST] Test setup for client logic
**Description:** Add a test runner for the non-visual logic (API client, state, helpers) with DOM/fetch mocking.
**Acceptance criteria:**
- `npm test` runs; a trivial logic test passes.
- A documented pattern exists for testing modules without a real browser.
**Blocked by:** KWC-201.
**Estimate:** S

---

# Feature: App Shell & Networking (3xx)

> The skeleton: a typed API client, auth handling, routing between views, and a global e-ink-aware render approach.

### KWC-301 — [TEST] API client module
**Description:** Tests for a typed client wrapping the API endpoints (sources, search, manga, pages, page image URL builder with `profile`, downloads, progress, library), including auth header injection and error mapping. Uses the capability-confirmed transport (fetch or XHR).
**Acceptance criteria:**
- Tests cover request shaping, auth header, and error/non-200 handling per endpoint.
- Page-image URL builder always requests `profile=eink`.
**Blocked by:** KWC-203.
**Estimate:** M

### KWC-302 — API client module (impl)
**Description:** Implement the API client satisfying KWC-301.
**Acceptance criteria:** All KWC-301 tests pass.
**Blocked by:** KWC-301.
**Estimate:** M

### KWC-303 — [TEST] Auth flow (single credential)
**Description:** Tests for entering/storing the single-user credential and attaching it to every request; handling 401 by returning to the credential prompt.
**Acceptance criteria:**
- Credential persists across reloads (storage mechanism confirmed available on-device).
- 401 from any call routes back to the credential entry view.
**Blocked by:** KWC-301.
**Estimate:** S

### KWC-304 — Auth flow (impl)
**Description:** Implement credential entry/storage satisfying KWC-303.
**Acceptance criteria:** All KWC-303 tests pass; verified on-device.
**Blocked by:** KWC-303, KWC-302.
**Estimate:** S

### KWC-305 — [TEST] View router
**Description:** Tests for a minimal router switching between views (library, search, manga details, reader) without a framework — hash or state based.
**Acceptance criteria:**
- Navigating between views updates state correctly; back navigation works.
- No full reloads between views.
**Blocked by:** KWC-203.
**Estimate:** S

### KWC-306 — View router (impl)
**Description:** Implement the router satisfying KWC-305.
**Acceptance criteria:** All KWC-305 tests pass.
**Blocked by:** KWC-305.
**Estimate:** S

### KWC-307 — [DEVICE] App shell & e-ink render policy
**Description:** Build the base layout (tap-based nav, large targets, no animation) and a central render helper that applies the refresh policy from KWC-103.
**Acceptance criteria:**
- Shell renders cleanly on-device with no ghosting on view changes.
- Tap targets meet the sizing guidance; navigation feels responsive on e-ink.
**Blocked by:** KWC-306, KWC-304, KWC-103, KWC-202.
**Estimate:** M

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

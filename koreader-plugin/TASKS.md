# TASKS — EPIC: KOReader Plugin Client

**Project:** KoManga
**Epic:** KOReader Plugin (a native-feel Kobo client that runs inside KOReader, using the full e-ink panel)
**Source of truth:** `RFC.md`
**Depends on epic:** API (consumes its REST endpoints — same contract as the web client)
**Conventions:** `CLAUDE.md` (this folder — read it before any `KRP-NNN` ticket)

## Why this epic exists

The web-client epic (`web-client/`) runs in the Kobo's Nickel browser. The device spike there found Nickel exposes only a **732×762** viewport on the 1072×1448 panel and surrounds it with browser chrome (a URL bar) the page cannot hide — there is no Fullscreen API and no way to reclaim the space from inside the page. A **KOReader plugin** escapes that: it draws to the full panel, has no browser chrome, and inherits KOReader's well-tuned e-ink refresh and CBZ reader. It is a *second client of the same API*, not a replacement — the API contract does not change to suit it (RFC §13).

## Conventions for this list

- **ID scheme:** `KRP-NNN`. Hundreds block = feature (1xx Spike & Dev Loop, 2xx Scaffold & Install, 3xx Networking Core, 4xx Browse & Search, 5xx Reader, 6xx Progress & Library, 7xx Polish & Hardening).
- **Two validation modes (not pure TDD), mirroring the web-client epic.** Pure-Lua **logic** (API client, auth, state, page mapping, progress debounce) gets `[TEST]` tickets (busted) that block their impl — mock the network at the `api/` boundary. **Visual / on-device behaviour** carries a **[DEVICE]** tag and is validated on the real Kobo; acceptance is a verified on-device check, not a passing unit test.
- **The emulator is an intermediate, not a substitute.** The KOReader desktop emulator (KRP-102) runs the plugin off-device for fast iteration, but **e-ink feel, refresh quality, and the real panel are only judgeable on the Kobo** — `[DEVICE]` tickets are never closed from the emulator alone.
- **Dependencies:** strict — a ticket cannot start until all `Blocked by` tickets are Done.
- **Estimates:** T-shirt (S / M / L).
- **No build step.** Lua is shipped as-is; "deploy" means copying the `.koplugin` to the device/emulator and reloading KOReader. Keep it lint-clean (`luacheck`).
- **Golden rule (inherited):** every feature is validated against the real device before being called Done. The emulator lies the way the monitor lies; the e-ink panel is the truth.

---

# Feature: Spike & Dev Loop (1xx)

> Must come first. Everything else is designed around what KOReader actually exposes on the target Kobo and how we iterate. Deliverable is knowledge (captured in `docs/koreader.md`, a shared doc sibling to `docs/device.md`) plus a working dev loop. Throwaway probe code is fine.

### KRP-101 — [DEVICE] Confirm KOReader on the target Kobo
**Status:** Done
**Description:** Install KOReader on the real Kobo Clara BW and capture the facts the plugin depends on: KOReader version, LuaJIT version, the plugin install path (`koreader/plugins/`), how KOReader is launched alongside Nickel (NickelMenu / KFMon), and that a trivial stub plugin loads and shows a menu entry. Confirm the panel is used full-screen (no browser chrome).
**Acceptance criteria:**
- KOReader version, LuaJIT version, plugin dir, and launch method documented in `docs/koreader.md`.
- A stub `.koplugin` loads on-device and its menu entry appears; full panel confirmed (no Nickel chrome).
**Dependencies:** none.
**Estimate:** M
**Outcome:** Verified on the real Kobo Clara BW (2026-06-28). KOReader **v2026.03** (LuaJIT 2.1), installed to `.adds/koreader/`; plugins live in `.adds/koreader/plugins/`. Launched via **KFMon v1.4.6** (`koreader.png` home-screen tile). Stub `komanga.koplugin` (`main.lua` + `_meta.lua`) loads clean: the **KoManga** main-menu entry appears and shows its `InfoMessage` popup; KOReader uses the full 1072×1448 panel with no Nickel chrome. Facts recorded in `docs/koreader.md`. Known gotcha documented there: Nickel imports KOReader's `resources/icons/*.svg` into the library as junk "books" — needs a DB cleanup, see KRP-703.

### KRP-102 — KOReader emulator dev environment
**Status:** Done
**Description:** Get the KOReader desktop emulator running on the dev Mac so the plugin can be exercised off-device (the SDL build). Document the run command and how to load the in-development plugin into it.
**Acceptance criteria:**
- Emulator runs locally and loads the stub plugin from KRP-101.
- `docs/koreader.md` records the run command and **what the emulator can and cannot validate** (logic/layout yes; e-ink refresh/feel no — device only).
**Blocked by:** KRP-101.
**Estimate:** M
**Outcome:** Verified on the dev Mac (Apple Silicon, macOS 26 / Darwin 25.0.0, 2026-06-28). KOReader ships no prebuilt macOS binary, so the SDL emulator is **built from source** at **`v2026.03`** (matching the device). To avoid global toolchain bloat, the whole thing lives in one git-ignored, deletable folder, `koreader-plugin/.emulator/`: a standalone `micromamba` plus a conda-forge build toolchain (cmake 3.x, autotools, nasm, ninja, meson, bash 5, GNU `getopt`/`flock` via `util-linux`, `g`-prefixed coreutils) — no `sudo`, nothing installed globally; only system Apple clang + system SDL3 are reused. Run loop: `source .emulator/buildenv.sh && cd .emulator/src && ./kodev run` (use `-b -W 1072 -H 1448 -D 300` or `--simulate=kobo-clara` for a device-shaped window). The stub `komanga.koplugin` is symlinked into the emulator's `plugins/` and loads clean — boot log shows `Plugin loaded komanga` / `RD loaded plugin komanga`, the KoManga menu entry + stub `InfoMessage` appear, no Lua errors. Build/run commands, macOS build gotchas, and the emulator can/cannot-validate split (layout/logic yes; e-ink refresh/feel + exact panel pixels no — Retina 2× backing + window clamping, device-only) recorded in `docs/koreader.md`. A one-command deploy/reload wrapper is deferred to KRP-203.

### KRP-103 — [TEST] Plugin test harness (busted)
**Status:** Done
**Description:** Set up `busted`-based unit testing for the plugin's pure-Lua logic, with the HTTP boundary mockable (inject a fake API client / fake transport).
**Acceptance criteria:**
- A documented command runs the specs; a trivial logic spec passes.
- A documented pattern exists for testing modules with the network mocked at the `api/` boundary (drop to the HTTP layer only when testing the API client itself — KRP-301).
**Blocked by:** KRP-101.
**Estimate:** S
**Outcome:** busted harness lives inside `komanga.koplugin/`: `.busted` config (ROOT=`spec`, pattern `_spec`, plugin-root `lpath`), `spec/run.sh` runner, `spec/smoke_spec.lua` (trivial passing logic spec), and `spec/support/fake_api.lua` + `fake_api_spec.lua` demonstrating the api-boundary mock pattern. No new toolchain: the runner reuses the **busted built by the emulator** (KRP-102) on the same LuaJIT the plugin ships on (globs the build dir, wires `LUA_PATH`/`LUA_CPATH` to its rocks tree), falling back to a `PATH` busted. Run with `koreader-plugin/komanga.koplugin/spec/run.sh` (location-independent, args pass through) — currently `4 successes / 0 failures`. Mocking pattern: inject a fake `ApiClient` (state/ui never touch HTTP); only KRP-301 mocks raw HTTP. Added `.luacheckrc` (std=luajit, `spec/` adds busted globals); luacheck binary not yet installed on the dev Mac (KRP-202 wires the lint pass). Run command + pattern documented in `docs/koreader.md`.

---

# Feature: Scaffold & Install (2xx)

> The plugin skeleton, its module layout, and a repeatable way to get it onto the device/emulator. No business logic yet.

### KRP-201 — Plugin skeleton & menu entry
**Status:** Done
**Description:** Create `komanga.koplugin` (`main.lua` + `_meta.lua`): a `WidgetContainer:extend` plugin (`name = "komanga"`, `is_doc_only = false`) that registers a **KoManga** entry via `addToMainMenu` and shows an `InfoMessage` when opened. Loads in the emulator and on-device.
**Acceptance criteria:**
- The KoManga menu entry appears; opening it shows the popup.
- Loads clean in the emulator and on the real Kobo (no load errors in the KOReader log).
**Blocked by:** KRP-102.
**Estimate:** S
**Outcome:** Promoted the KRP-101 throwaway stub into the real plugin entry point — `main.lua` is now framed as the entry (`WidgetContainer:extend{ name = "komanga", is_doc_only = false }`, registers the **KoManga** main-menu entry via `addToMainMenu`, opening it shows an `InfoMessage`); `_meta.lua` carries name/fullname/description. Module layout (`api/`/`state/`/`ui/`, config, settings) is deferred to KRP-202 per the ticket split. Verified in the emulator (built v2026.03, KRP-102): headless boot log shows `Plugin loaded komanga` + `FM loaded plugin komanga at plugins/komanga.koplugin` with no errors/tracebacks; both files parse on the device's LuaJIT 2.1; the 4-spec busted suite still passes. luacheck not yet run (binary install + lint pass is KRP-202). On-device confirmation rides on the same skeleton already verified loading on the real Kobo in KRP-101.

### KRP-202 — Module layout, config & settings
**Status:** Done
**Description:** Establish the internal structure (CLAUDE.md §5): `api/` (networking — the only place HTTP lives), `state/` (pure logic), `ui/` (widgets), plus a single `config` module and `LuaSettings`-backed persistence. Config holds the API base URL and tuning knobs (prefetch window, progress-debounce interval).
**Acceptance criteria:**
- Documented module layout; `config` returns the API base + knobs; settings persist via `LuaSettings`.
- `luacheck` clean across the plugin.
**Blocked by:** KRP-201.
**Estimate:** S
**Outcome:** Internal structure established inside `komanga.koplugin/`: `config.lua` (defaults — `api_base_url` = the absolute Cloudflare Tunnel origin, unlike the same-origin web client; `prefetch_window`; `progress_debounce_seconds`) and `settings.lua` (pure logic over an injected LuaSettings-like store via `Settings.new(store)`, with `Settings.open()` the runtime factory opening `settings/komanga.lua` through `DataStorage`+`LuaSettings`; getters fall back to `config` defaults, setters `flush()` so the credential survives a restart — KRP-303). `api/`, `state/`, `ui/` created as namespaces (each with a role-noting `.gitkeep`); `net.lua` is deferred to KRP-305. Sibling modules load by bare name (the plugin loader prepends the plugin root to `package.path`). `main.lua` now opens settings on `init()`. Wired the lint pass: installed `luacheck` 1.2.0 into the emulator build's rocks tree (no global install, same footprint as busted) and added `spec/lint.sh` (mirrors `run.sh`); `.luacheckrc` now mirrors KOReader's (`unused_args=false`, `self=false`). **luacheck clean — 0 warnings / 0 errors across 10 files**; busted **12 successes / 0 failures** (added `config_spec`, `settings_spec`, `spec/support/fake_store.lua`). Verified loading clean in the emulator (`Plugin loaded komanga` / `FM loaded plugin komanga`, no traceback — so `Settings.open()`'s runtime LuaSettings path resolves). Module layout, config/settings split, and the lint command documented in `docs/koreader.md`.

### KRP-203 — Install / reload dev scripts
**Description:** A repeatable way to copy the `.koplugin` to the emulator's and the device's `koreader/plugins/` and reload, so the dev loop is one command, not manual file shuffling.
**Acceptance criteria:**
- Documented scripts/commands deploy to the emulator and to the Kobo (over USB/SSH per KRP-101's findings) and reload the plugin.
- A change to `main.lua` is reflected after running the deploy step.
**Blocked by:** KRP-201.
**Estimate:** S

---

# Feature: Networking Core (3xx)

> A typed-ish API client, auth, and non-blocking network handling. The same API contract as the web client (`profile=eink`, single credential, device-agnostic progress).

### KRP-301 — [TEST] API client (HTTP layer)
**Description:** Tests for a Lua client wrapping the REST endpoints (sources, search, manga, chapter pages, page-image URL builder with `profile`, chapter download, downloads list, progress, library), including auth-header injection, the `{ data }` envelope unwrap, and error mapping (401 / non-200 / transport failure). Mock at the HTTP boundary.
**Acceptance criteria:**
- Per-endpoint request shaping, auth header, and error/non-200 handling covered.
- Page-image and CBZ URL builders always request `profile=eink` (never `raw`).
**Blocked by:** KRP-103.
**Estimate:** M

### KRP-302 — API client (impl)
**Description:** Implement the client satisfying KRP-301 using `socket.http`/`ssl.https` + `ltn12` + `rapidjson`; read the credential per request from settings; map the envelope and typed errors.
**Acceptance criteria:** All KRP-301 tests pass.
**Blocked by:** KRP-301.
**Estimate:** M

### KRP-303 — [TEST] Auth flow (single credential)
**Description:** Tests for entering/storing the single credential (`LuaSettings`), attaching it to every request, and handling a 401 by returning to the credential prompt.
**Acceptance criteria:**
- Credential persists across a KOReader restart (settings-backed).
- A 401 from any call routes back to the credential entry flow.
**Blocked by:** KRP-301.
**Estimate:** S

### KRP-304 — Auth flow (impl)
**Description:** Implement credential entry (`InputDialog`), `LuaSettings` persistence, and the 401 handler satisfying KRP-303.
**Acceptance criteria:** All KRP-303 tests pass; verified in the emulator and on-device.
**Blocked by:** KRP-303, KRP-302.
**Estimate:** S

### KRP-305 — Async networking & wifi gating
**Description:** Wrap all API calls so the UI never freezes: `Trapper` for coroutine-driven calls with a dismissable loading/cancel dialog, and `NetworkMgr` to ensure wifi is up before a call (turn it on / prompt if off). Every view calls the API through this wrapper.
**Acceptance criteria:**
- A slow call shows a clear, dismissable loading state; the UI stays responsive (not frozen).
- A call with wifi off prompts/enables wifi instead of failing silently.
- The wrapper is the single path views use for network calls.
**Blocked by:** KRP-302.
**Estimate:** M

---

# Feature: Browse & Search (4xx)

> Source list, search, manga details + chapter list — built from KOReader's `Menu` widget. Metadata only; no page images yet.

### KRP-401 — [TEST] Source list & search (logic)
**Description:** Tests for the logic behind listing sources and running a search (query + source), pagination / "load more", and empty/error states, against the mocked API client.
**Acceptance criteria:**
- Search submits query + source; results populate state; empty + error states handled.
- Pagination / load-more advances correctly.
**Blocked by:** KRP-302.
**Estimate:** M

### KRP-402 — Source list & search (UI)
**Description:** Build the source list and search UI on KOReader's `Menu` widget (`InputDialog` for the query), wiring in the KRP-401 logic via the KRP-305 network wrapper.
**Acceptance criteria:** KRP-401 logic drives a working `Menu` UI; runs in the emulator.
**Blocked by:** KRP-401, KRP-305.
**Estimate:** M

### KRP-403 — [TEST] Manga details & chapter list (logic)
**Description:** Tests for the manga details view: details, ordered chapter list, follow/unfollow action, and surfacing reading direction (RTL/LTR) + last-read position.
**Acceptance criteria:**
- Chapter list in correct order; last-read chapter indicated.
- Follow/unfollow toggles state and calls the API.
**Blocked by:** KRP-302.
**Estimate:** M

### KRP-404 — Manga details & chapter list (UI)
**Description:** Build the details + chapter-list UI (`Menu`) with the follow action, wiring in KRP-403.
**Acceptance criteria:** KRP-403 logic drives a working UI; runs in the emulator.
**Blocked by:** KRP-403, KRP-305.
**Estimate:** M

### KRP-405 — [DEVICE] Browse/search on-device pass
**Description:** Validate the full browse path on the real Kobo: list legibility, cover thumbnails (via the `eink` profile), and paging/responsiveness through results and chapters.
**Acceptance criteria:**
- Covers and text render legibly; no broken layout on the real panel.
- Result/chapter paging is usable and responsive.
**Blocked by:** KRP-402, KRP-404.
**Estimate:** M

---

# Feature: Reader (5xx)

> The core experience. **Primary path: read via KOReader's native CBZ reader** — the API already builds `eink` CBZs (API epic), and `ReaderUI:showReader` gives paging, zoom, RTL, and e-ink refresh for free. On-demand streaming is added as a refinement once the CBZ path works end-to-end.

### KRP-501 — [TEST] Chapter acquisition & page mapping (logic)
**Description:** Tests for acquiring a chapter for reading: request the chapter's `eink` CBZ via the API download endpoint, track build/download status, retrieve the stored CBZ, and map the API page index ↔ CBZ page index. (If a direct "fetch built CBZ bytes" endpoint is missing from the API, that is an **API-epic ticket**, not a client hack — RFC §13.)
**Acceptance criteria:**
- Chapter acquisition requests `profile=eink`; status tracked; page-index mapping correct.
- Network mocked at the `api/` boundary.
**Blocked by:** KRP-302.
**Estimate:** M

### KRP-502 — Open chapter in KOReader's reader (impl)
**Description:** Download the chapter CBZ to the plugin's downloads dir and hand off to `ReaderUI:showReader(path)`, honouring reading direction (RTL/LTR) from the manga metadata. Satisfies the acquisition logic from KRP-501.
**Acceptance criteria:**
- A chapter opens in KOReader's native reader from the plugin; pages render; RTL honoured.
- KRP-501 tests pass.
**Blocked by:** KRP-501, KRP-305.
**Estimate:** M

### KRP-503 — [DEVICE] Reading experience on-device
**Description:** Validate a multi-page chapter on the real Kobo via the CBZ+reader path: full-panel rendering, page-turn responsiveness, controlled ghosting (KOReader refresh), and correct RTL/LTR.
**Acceptance criteria:**
- Pages fill the panel with no distortion; RTL/LTR correct.
- Page turns are responsive; refresh is clean across a multi-page chapter.
**Blocked by:** KRP-502.
**Estimate:** L

### KRP-504 — [TEST] On-demand streaming / prefetch window (logic)
**Description:** Tests for the "read without downloading the whole chapter" refinement: stream pages within a bounded, configurable window so the next page is ready on turn; already-fetched pages need no refetch.
**Acceptance criteria:**
- Viewing page N triggers fetch of the next page(s) within the window.
- Already-fetched pages display without a new network round-trip.
**Blocked by:** KRP-501.
**Estimate:** M

### KRP-505 — Streaming reader (impl)
**Description:** Implement bounded streaming satisfying KRP-504 — either a custom paged image viewer (`ImageWidget` + tap zones + `setDirty` refresh) or progressive CBZ assembly handed to `ReaderUI`. Reading direction honoured for page order and tap zones.
**Acceptance criteria:** All KRP-504 tests pass.
**Blocked by:** KRP-504, KRP-502.
**Estimate:** L

### KRP-506 — [DEVICE] In-reader menu & loading/error states
**Description:** Add the in-reader actions (download-this-chapter, chapter/page jump) and on-device-legible loading/error/retry states for slow or failed page/CBZ fetches, integrated with KOReader's reader without disrupting reading position.
**Acceptance criteria:**
- A slow/failed fetch shows a clear loading/retry state, never a blank panel.
- "Download chapter" triggers the API download endpoint and reflects status.
- The menu opens/closes without losing reading position.
**Blocked by:** KRP-505.
**Estimate:** M

---

# Feature: Progress & Library (6xx)

> Wire the reader to server-side progress sync and a library/home view.

### KRP-601 — [TEST] Progress sync (logic)
**Description:** Tests that turning a page pushes progress to the API (debounced), and that opening a manga resumes from the stored last-read position (last-write-wins). Covers mapping KOReader reader page events ↔ API progress.
**Acceptance criteria:**
- Page turns push progress, debounced (not every turn hammering the API).
- Reopening a manga resumes at the synced position.
**Blocked by:** KRP-502.
**Estimate:** M

### KRP-602 — Progress sync (impl)
**Description:** Hook KOReader's reader page-update/close events to push debounced progress and resume on open, satisfying KRP-601.
**Acceptance criteria:** All KRP-601 tests pass; verified resuming across two sessions on-device.
**Blocked by:** KRP-601, KRP-506.
**Estimate:** S

### KRP-603 — [TEST] Library / home view (logic)
**Description:** Tests for the library/home view: followed manga, resume-reading shortcuts, downloaded chapters list.
**Acceptance criteria:**
- Followed manga + last-read render; "continue reading" jumps into the reader.
- Downloaded chapters are listed and openable.
**Blocked by:** KRP-302.
**Estimate:** M

### KRP-604 — Library / home view (UI)
**Description:** Build the library/home UI (`Menu`) satisfying KRP-603, including continue-reading and the downloaded-chapters list.
**Acceptance criteria:** All KRP-603 logic is wired into a working UI; runs in the emulator.
**Blocked by:** KRP-603, KRP-402.
**Estimate:** M

---

# Feature: Polish & Hardening (7xx)

> Final pass once the app works end-to-end. Real-device tuning, resilience, install/launch, and full acceptance.

### KRP-701 — [DEVICE] E-ink refresh & legibility tuning
**Description:** Tune refresh behaviour (`UIManager:setDirty` modes for menus and page turns) and font sizes/contrast in the plugin's views, across all screens on the real panel. Document settled values in `docs/koreader.md`.
**Acceptance criteria:**
- Text legible and refresh clean across views on-device.
- Settled values documented.
**Blocked by:** KRP-604, KRP-506.
**Estimate:** M

### KRP-702 — Network resilience & offline downloaded reading
**Description:** Handle flaky/lost wifi gracefully (`NetworkMgr`) and ensure already-downloaded CBZ chapters open and read with the network off.
**Acceptance criteria:**
- A dropped connection shows a clear state and retry, never a hard crash.
- A previously downloaded chapter opens and reads with wifi off.
**Blocked by:** KRP-506, KRP-604.
**Estimate:** M

### KRP-703 — [DEVICE] Install & launch experience
**Description:** Make installing/updating the plugin and launching into KoManga as smooth as KOReader allows (a documented install/update step and a sensible landing view via the menu entry / NickelMenu).
**Acceptance criteria:**
- A documented, repeatable install/update path on-device.
- Opening KoManga lands on the library/home view, loading acceptably.
**Blocked by:** KRP-701.
**Estimate:** S

### KRP-704 — [DEVICE] Full end-to-end on-device acceptance
**Description:** Full journey on the real Kobo: auth → search → follow → read (streamed) → download → read downloaded → resume across a session.
**Acceptance criteria:**
- Every step succeeds on-device.
- Streamed reading and downloaded reading both work; progress resumes correctly.
- No blocking legibility or refresh issues remain.
**Blocked by:** KRP-702, KRP-703.
**Estimate:** M

---

## Suggested build order (respecting strict deps)

1. **Spike first:** KRP-101 → 102 / 103. *Do not start the scaffold until the dev loop + `docs/koreader.md` exist.*
2. **Scaffold:** KRP-201 → 202 / 203.
3. **Networking:** 301→302, 303→304, → 305.
4. **Browse:** 401→402, 403→404 → 405 (device pass).
5. **Reader (CBZ first, then streaming):** 501→502 → 503 (device pass) → 504→505 → 506.
6. **Progress & library:** 601→602, 603→604.
7. **Polish:** 701 → 703, 702, → 704 (final acceptance).

> Notes:
> - **The spike gates everything** — KOReader version, install/launch, and the emulator loop are what the rest assumes. Don't shortcut it.
> - **`[DEVICE]` tickets are validated on the real Kobo**, not the emulator and not unit tests — the acceptance criteria reflect that.
> - **Same API contract as the web client.** This client requests `profile=eink`, attaches the single credential, and treats progress as device-agnostic/last-write-wins. If something is missing from the API, raise an **API-epic** ticket — don't change the contract or hack the client (RFC §13).
> - **Reader leans on KOReader.** CBZ + `ReaderUI` first (high confidence, gives offline reading immediately); on-demand streaming is the refinement on top.

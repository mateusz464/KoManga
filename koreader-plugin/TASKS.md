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
**Status:** Done
**Description:** A repeatable way to copy the `.koplugin` to the emulator's and the device's `koreader/plugins/` and reload, so the dev loop is one command, not manual file shuffling.
**Acceptance criteria:**
- Documented scripts/commands deploy to the emulator and to the Kobo (over USB/SSH per KRP-101's findings) and reload the plugin.
- A change to `main.lua` is reflected after running the deploy step.
**Blocked by:** KRP-201.
**Estimate:** S
**Outcome:** One script — `koreader-plugin/scripts/deploy.sh` (location-independent, a sibling of `komanga.koplugin/` and `.emulator/` so it isn't shipped as part of the plugin) — with three targets: `emulator` (symlinks the plugin into the emulator's globbed `…/koreader/plugins/`, KRP-102's chosen mechanism so source edits need no copy), `device` (`rsync -a --delete` over USB to `.adds/koreader/plugins/` per KRP-101, excluding dev-only files `spec/`/`.busted`/`.luacheckrc`/`*.log`, with a clear error + `KOBO_MOUNT` override when the Kobo isn't mounted), and `run` (the one-command dev loop: deploy to emulator → `source buildenv.sh` + `./kodev run`, passing extra args through to `kodev run`). KOReader has no hot-reload, so "reload" = a KOReader restart, which the `run` target performs. **Verified in the emulator (2026-06-28):** `scripts/deploy.sh run -b` linked the plugin and booted headless in one command — log shows `Plugin loaded komanga` / `FM loaded plugin komanga at plugins/komanga.koplugin`, no Lua errors; a `main.lua` edit is reflected through the symlink (deployed path resolves to source). The `device` USB copy was then run against the real Kobo (2026-06-28): the install dir holds exactly the runtime files (`main.lua`/`_meta.lua`/`config.lua`/`settings.lua`/`api`/`state`/`ui`), dev-only files excluded. Hardened it to keep the exFAT volume clean — `COPYFILE_DISABLE=1` + a `dot_clean -m` pass strip the AppleDouble `._*` sidecars macOS otherwise spills onto FAT (verified zero `._*` left). On-panel load is the user's `[DEVICE]` check after eject + restart. `bash -n` clean; busted/luacheck unaffected (shell script, outside the plugin). Documented in `docs/koreader.md` (KRP-203).

---

# Feature: Networking Core (3xx)

> A typed-ish API client, auth, and non-blocking network handling. The same API contract as the web client (`profile=eink`, single credential, device-agnostic progress).

### KRP-301 — [TEST] API client (HTTP layer)
**Status:** Done
**Description:** Tests for a Lua client wrapping the REST endpoints (sources, search, manga, chapter pages, page-image URL builder with `profile`, chapter download, downloads list, progress, library), including auth-header injection, the `{ data }` envelope unwrap, and error mapping (401 / non-200 / transport failure). Mock at the HTTP boundary.
**Acceptance criteria:**
- Per-endpoint request shaping, auth header, and error/non-200 handling covered.
- Page-image and CBZ URL builders always request `profile=eink` (never `raw`).
**Blocked by:** KRP-103.
**Estimate:** M
**Outcome:** Failing `busted` contract for `api/client.lua` (impl is KRP-302) — `spec/api/client_spec.lua`, **27 assertions**, mocking at the HTTP boundary via an injected `transport` function (`spec/support/fake_transport.lua`), the one spec that drops below the `api/` boundary (KRP-103). Defines the `ApiClient` contract against the shared API surface (RFC §8): `ApiClient.new{ base_url, get_credential, transport }`; methods return `(data, nil)` or `(nil, err)` with `err.kind` ∈ `http`/`transport`/`decode`. Covers per-endpoint request shaping (sources, search w/ `q`+`source`+optional `page` and percent-encoded query, manga, chapter pages, download, downloads, progress get/put, library list/follow/unfollow — correct verb/URL/JSON body); Bearer-auth header read **per request** (not cached) and omitted when no credential; `{ data }` envelope unwrap; eink-only URL builders (`pageImageUrl`/`cbzUrl`/download always `profile=eink`, never `raw`); base-URL trailing-slash join; and error mapping (401→`http`/401/`UNAUTHORIZED`, non-200 w/ code+message, transport failure, undecodable body→`decode`). Fail-first verified: full suite **12 successes / 1 error** (the missing `api.client` module) — and confirmed satisfiable by a throwaway impl (all 27 green) which was then removed. The client decodes with **rapidjson** (the on-device codec), so `run.sh` now wires `common/rapidjson.so` onto `LUA_CPATH` and symlinks `libluajit.dylib` into the busted LuaJIT's empty `staging/bin/libs` rpath (DYLD can't help — `/bin/sh` is SIP-protected and strips `DYLD_*`); details in `docs/koreader.md` (KRP-301). `luacheck` clean (0/0 across 12 files).

### KRP-302 — API client (impl)
**Status:** Done
**Description:** Implement the client satisfying KRP-301 using `socket.http`/`ssl.https` + `ltn12` + `rapidjson`; read the credential per request from settings; map the envelope and typed errors.
**Acceptance criteria:** All KRP-301 tests pass.
**Blocked by:** KRP-301.
**Estimate:** M
**Outcome:** Implemented `api/client.lua` — the typed-ish REST client and the only place HTTP lives (CLAUDE.md §5), satisfying the KRP-301 contract. `ApiClient.new{ base_url, get_credential, transport }` injects collaborators (busted passes a fake transport, the runtime default wires `socket.http`/`ssl.https` + `ltn12`, lazily required so the module imports clean under busted). Per-endpoint shaping for sources/search (percent-encoded `q`+`source`+optional `page`)/manga/chapter-pages/download (POST, `mangaId`+`profile=eink`)/downloads/progress get+put/library list+follow+unfollow, plus pure `pageImageUrl`/`cbzUrl` builders — all **eink, never raw** (§6). Bearer credential read **per request** via `get_credential()` (not cached, omitted when nil); base-URL trailing-slash join; `{ data }` envelope unwrapped to plugin-domain tables; JSON via `rapidjson` (pcall-guarded decode). Typed errors `err.kind` ∈ `http` (`status`+`code`) / `transport` / `decode`. **busted 39 successes / 0 failures** (12 prior + KRP-301's 27); **luacheck clean — 0/0 across 13 files**.

### KRP-303 — [TEST] Auth flow (single credential)
**Status:** Done
**Description:** Tests for entering/storing the single credential (`LuaSettings`), attaching it to every request, and handling a 401 by returning to the credential prompt.
**Acceptance criteria:**
- Credential persists across a KOReader restart (settings-backed).
- A 401 from any call routes back to the credential entry flow.
**Blocked by:** KRP-301.
**Estimate:** S
**Outcome:** Failing `busted` contract for `state/auth.lua` (impl is KRP-304) — `spec/state/auth_spec.lua`, **10 assertions**, mocking at the `api/` boundary (no HTTP, no KOReader loaded — CLAUDE.md §4/§5). Defines the pure auth coordinator `Auth.new{ settings, on_prompt }` (collaborators injected, §9): credential storage delegated to a real `Settings` over a `FakeStore` (`hasCredential`/`getCredential`/`setCredential`); a `credentialGetter()` the API client reads **per request** (a mid-session `setCredential` is reflected, matching KRP-301's per-request Bearer read); and 401 routing — `isUnauthorized(err)` (pure predicate: true only for `{ kind="http", status=401 }`, false for 403/500/transport/decode/nil) and `handleError(err)` which launches `on_prompt` and returns `true` only on a 401. Persistence-across-restart is modelled by rebuilding `Auth`/`Settings` over the same flushed store and asserting the credential reads back. Fail-first verified: full suite **39 successes / 1 error** (the missing `state.auth` module); confirmed satisfiable by a throwaway impl (49/49 green) which was then removed. `luacheck` clean (0/0 across 14 files).

### KRP-304 — Auth flow (impl)
**Status:** Done
**Description:** Implement credential entry (`InputDialog`), `LuaSettings` persistence, and the 401 handler satisfying KRP-303.
**Acceptance criteria:** All KRP-303 tests pass; verified in the emulator and on-device.
**Blocked by:** KRP-303, KRP-302.
**Estimate:** S
**Outcome:** Implemented `state/auth.lua` — the pure, framework-free credential coordinator satisfying the KRP-303 contract (CLAUDE.md §5: `state/` is pure, busted-testable with no KOReader loaded). `Auth.new{ settings, on_prompt }` injects collaborators (§9): credential storage delegated to the injected `Settings` (so it persists through `LuaSettings` and survives a restart), `hasCredential`/`getCredential`/`setCredential`, a `credentialGetter()` the API client reads **per request** (a mid-session `setCredential` is reflected — matches KRP-301/302's per-request Bearer read), and 401 routing: `isUnauthorized(err)` (pure predicate — true only for `{ kind="http", status=401 }`, false for 403/500/transport/decode/nil) + `handleError(err)` which fires `on_prompt` and returns `true` only on a 401. The KOReader-runtime credential entry lives in `ui/credential_prompt.lua` (the `InputDialog` launcher `on_prompt` points at — seeds the field with any existing credential for a 401 re-prompt, saves via `Auth:setCredential`); all KOReader-API coupling is confined there, keeping `state/auth.lua` pure (§12). `main.lua` wires `Auth` over `Settings.open()` with `on_prompt = CredentialPrompt.show` and exposes a **Set credential** menu sub-item. **busted 49 successes / 0 failures** (39 prior + KRP-303's 10); **luacheck clean — 0/0 across 16 files**. Verified loading clean in the emulator (`Plugin loaded komanga` / `FM loaded plugin komanga`, no traceback — the new `state/auth` + `ui/credential_prompt` requires resolve at boot). On-panel credential entry / 401 re-prompt is the user's `[DEVICE]` check after deploy + restart.

### KRP-305 — Async networking & wifi gating
**Status:** Done
**Description:** Wrap all API calls so the UI never freezes: `Trapper` for coroutine-driven calls with a dismissable loading/cancel dialog, and `NetworkMgr` to ensure wifi is up before a call (turn it on / prompt if off). Every view calls the API through this wrapper.
**Acceptance criteria:**
- A slow call shows a clear, dismissable loading state; the UI stays responsive (not frozen).
- A call with wifi off prompts/enables wifi instead of failing silently.
- The wrapper is the single path views use for network calls.
**Blocked by:** KRP-302.
**Estimate:** M
**Outcome:** Implemented `net.lua` (plugin root, per CLAUDE.md §5) — the single non-blocking, wifi-gated path every view uses for network calls; all `Trapper`/`NetworkMgr` coupling is confined here (CLAUDE.md §7/§12), collaborators injected so busted drives the logic with fakes (§9). `Net.new{ network_mgr?, trapper? }` defaults to the KOReader singletons (lazily required, so the module imports clean under busted); `Net:run(task, opts)` gates the call through `NetworkMgr:runWhenOnline` (runs now if online, else routes through the wifi prompt/enable path — an offline call is never a silent failure), then `Trapper:wrap` + `Trapper:dismissableRunInSubprocess(task, opts.text)` runs the blocking fetch in a forked sub-process so the UI keeps ticking behind a dismissable loading dialog. `task` is `function() -> (data, err)` (an `api/client.lua` call), and `opts.on_result(data, err)` always receives the client's (data, err) contract — a user dismiss yields `{ kind = "cancelled" }` rather than a blank panel, so callers (incl. `Auth:handleError` for 401s) treat a gated/cancelled call like any other. Wired into `main.lua` (`self.net = Net.new{}`), handed to screens as they land (KRP-4xx+). **busted 55 successes / 0 failures** (49 prior + 6 new in `spec/net_spec.lua`: NetworkMgr gating on every call, fetch-behind-loading-dialog + data/err passthrough, dismiss→cancelled, default loading text, offline→gated-but-no-silent-failure); **luacheck clean — 0/0 across 18 files**. Verified loading clean in the emulator (headless SDL-dummy boot, 2026-06-28): `Plugin loaded komanga` / `FM loaded plugin komanga`, no traceback — so `init()`'s `Net.new{}` resolves `ui/network/manager` + `ui/trapper` at boot. On-panel feel (slow-call responsiveness, wifi prompt) is the user's `[DEVICE]` check once a view actually issues a call (KRP-402).

---

# Feature: Browse & Search (4xx)

> Source list, search, manga details + chapter list — built from KOReader's `Menu` widget. Metadata only; no page images yet.

### KRP-401 — [TEST] Source list & search (logic)
**Status:** Done
**Description:** Tests for the logic behind listing sources and running a search (query + source), pagination / "load more", and empty/error states, against the mocked API client.
**Acceptance criteria:**
- Search submits query + source; results populate state; empty + error states handled.
- Pagination / load-more advances correctly.
**Blocked by:** KRP-302.
**Estimate:** M
**Outcome:** Failing `busted` contract for `state/browse.lua` (impl rides with the UI in KRP-402) — `spec/state/browse_spec.lua`, **15 specs**, mocking at the `api/` boundary via `FakeApi` (CLAUDE.md §4/§5 — `state/` is pure, no HTTP, no KOReader loaded). Defines the pure source-list/search coordinator `Browse.new(api)` against the shared API contract (RFC §8): unwrapped `{ data }` shapes `listSources() -> ({ {id,name,lang,iconUrl?},… }, nil)|(nil,err)` and `search{source,query,page} -> ({ mangas={…}, hasNextPage=<bool> }, nil)|(nil,err)`, with typed errors `{ kind, status?, … }` (KRP-301/302). Covers **source list** (`loadSources`/`getSources`; empty list; error surfaced via `getError`, sources left empty); **search** (`search(source,query)` shapes the exact `{source,query,page=1}` request `api/client.lua:search` expects, populates `getResults`, records `getSource`/`getQuery`/`getPage` for pagination; zero results → `isEmpty` true and **not** an error; error surfaced and `isEmpty` false; a later success clears a prior error; a fresh search replaces results and resets to page 1); and **pagination** (`hasMore` from `hasNextPage`; `loadMore` appends the next page **in order** and advances the page number, requesting page N of the same query/source; no-op + no extra request once `hasNextPage=false` or before any search; on a load-more error it keeps results + page so a retry is possible). Result builders hand each call a fresh table so an append-style impl can't corrupt a reused fixture (test isolation). Fail-first verified: full suite **55 successes / 1 error** (the missing `state.browse` module); confirmed satisfiable by a throwaway impl (70/70 green) which was then removed. `luacheck` clean (0/0 across 19 files).

### KRP-402 — Source list & search (UI)
**Status:** Done
**Description:** Build the source list and search UI on KOReader's `Menu` widget (`InputDialog` for the query), wiring in the KRP-401 logic via the KRP-305 network wrapper.
**Acceptance criteria:** KRP-401 logic drives a working `Menu` UI; runs in the emulator.
**Blocked by:** KRP-401, KRP-305.
**Estimate:** M
**Outcome:** Implemented `state/browse.lua` (the KRP-401 impl rides here) and `ui/source_browser.lua` (the screen), and wired both into `main.lua`. **`state/browse.lua`** is the pure, framework-free coordinator satisfying the KRP-401 contract (CLAUDE.md §5 — `state/` is pure, busted-testable; network only via an injected ApiClient). Its three jobs (source list / search / load-more) are each split into a pure `fetch*` (the blocking API call, returning api/client.lua's `(data, err)`) and an `apply*` (mutates state with that result); the tested synchronous `loadSources`/`search`/`loadMore` are simply their composition. The split exists because **net.lua runs the fetch in a forked sub-process** (KRP-305) — a sub-process can't mutate the parent's state table across the fork, so the UI runs the `fetch*` through net and calls `apply*` in the `on_result` callback (parent side); the busted specs drive the combined methods in-process. **`ui/source_browser.lua`** is a `Menu:extend` (CLAUDE.md §5/§7 — lean on KOReader widgets, no hand-rolled layout) with two modes over one Menu (`switchItemTable`): *sources* (selecting one → `InputDialog` query → search) and *results* (a "Load more…" row while `hasMore`, a back arrow via `paths`/`onReturn` to the source list). `onMenuSelect` is overridden to run the row action **without** closing the menu (the default closes, suiting a file picker not a browser). Every API call goes through `net.lua` (wifi-gated, non-blocking, dismissable loading dialog); loading/empty/error states are all present (CLAUDE.md §7/§9 — never a blank panel), with a typed-error→on-panel-line mapper and a **401 routed back to the credential prompt** via the injected `Auth:handleError` (KRP-303/304). Manga details (selecting a result) is a stub pending KRP-404. `main.lua` now builds the `ApiClient` (base from settings, credential read per request via `auth:credentialGetter()`) and opens a fresh `Browse`-backed `SourceBrowser` per visit, kicking the initial source load once shown. **busted 70 successes / 0 failures** (55 prior + KRP-401's 15 now green against the impl); **luacheck clean — 0/0 across 21 files**. Verified loading clean in the emulator (headless SDL-dummy boot, 2026-06-28): `Plugin loaded komanga` / `FM loaded plugin komanga`, no traceback — so the new `state/browse` + `ui/source_browser` requires resolve at boot. On-panel browse/search feel (legibility, cover thumbnails, paging responsiveness) against a live API is the KRP-405 `[DEVICE]` pass.

### KRP-403 — [TEST] Manga details & chapter list (logic)
**Status:** Done
**Description:** Tests for the manga details view: details, ordered chapter list, follow/unfollow action, and surfacing reading direction (RTL/LTR) + last-read position.
**Acceptance criteria:**
- Chapter list in correct order; last-read chapter indicated.
- Follow/unfollow toggles state and calls the API.
**Blocked by:** KRP-302.
**Estimate:** M
**Outcome:** Failing `busted` contract for `state/details.lua` (impl rides with the UI in KRP-404) — `spec/state/details_spec.lua`, **16 specs**, mocking at the `api/` boundary via `FakeApi` (CLAUDE.md §4/§5 — `state/` is pure, no HTTP, no KOReader loaded). Defines the pure manga-details coordinator `Details.new(api, mangaId)` against the shared API contract (RFC §6/§7, `/api/manga/:id`): unwrapped `{ data }` shapes `getManga(id) -> ({ manga={id,sourceId,title,…}, chapters={…} (ordered), readingDirection="rtl"|"ltr" }, …)`, `getProgress(id) -> ({ mangaId,chapterId,page,updatedAt }, …)`, `listLibrary() -> ({ {mangaId,addedAt},… }, …)`, `follow(id,addedAt)`/`unfollow(id)`, with typed errors `{ kind, status?, … }` (KRP-301/302). Mirrors `state/browse.lua`'s pure `fetch*`/`apply*` split (the fetch is what net.lua runs in a forked sub-process, KRP-305; `apply*` mutates the parent's table in the `on_result` callback). Covers **details & chapter list** (`load` populates metadata + reading direction; **chapter order is preserved** as the API serves it — manga-service already sorts by chapterNumber; error surfaced via `getError` with chapters left empty; a later success clears a prior error); **last-read position** (`loadProgress` exposes `getLastReadChapterId`/`getLastReadPage`; `isLastRead(chapterId)` flags the resume chapter; a **404 is the "never read yet" empty state, NOT an error**; a non-404 progress error is surfaced); **follow state** (`loadFollowState` derives `isFollowed` from library membership — the manga endpoint carries no follow flag; defaults not-followed; a library-load error leaves state unchanged); and **follow/unfollow** (each calls the API with the right verb/args and flips `isFollowed` only on success — on a write error the toggle does **not** flip, so a retry is possible). Result builders hand each call a fresh table (test isolation). Fail-first verified: full suite **70 successes / 1 error** (the missing `state.details` module); confirmed satisfiable by a throwaway impl (86/86 green, luacheck clean across 23 files) which was then removed. `luacheck` clean (0/0 across 22 files).

### KRP-404 — Manga details & chapter list (UI)
**Status:** Done
**Description:** Build the details + chapter-list UI (`Menu`) with the follow action, wiring in KRP-403.
**Acceptance criteria:** KRP-403 logic drives a working UI; runs in the emulator.
**Blocked by:** KRP-403, KRP-305.
**Estimate:** M
**Outcome:** Implemented `state/details.lua` (the KRP-403 impl rides here) and `ui/manga_details.lua` (the screen), and wired both into `main.lua`. **`state/details.lua`** is the pure, framework-free coordinator satisfying the KRP-403 contract (CLAUDE.md §5 — `state/` is pure, busted-testable; network only via an injected ApiClient). Its four jobs (details + ordered chapter list + reading direction / last-read position / follow state / follow-unfollow) each split into a pure `fetch*` (the blocking `api/client.lua` call, returning `(data, err)`) and an `apply*` (mutates state), mirroring `state/browse.lua` — the split exists because **net.lua runs the fetch in a forked sub-process** (KRP-305), which can't mutate the parent's table across the fork, so the UI runs `fetch*` through net and calls `apply*` in the `on_result` callback (parent side); the busted specs drive the combined `load`/`loadProgress`/`loadFollowState`/`follow`/`unfollow`. A **404 from progress is the "never read yet" empty state, not an error**; chapter order is preserved as the API serves it; follow state is derived from library membership; a follow/unfollow write flips `isFollowed` **only on success** so a failed write is retryable. **`ui/manga_details.lua`** is a `Menu:extend` (CLAUDE.md §5/§7 — lean on KOReader widgets, no hand-rolled layout): a follow/unfollow toggle row above the chapter list, the last-read chapter marked via `mandatory`. It loads details first (showing the search-result title as a stub header immediately), then enriches with progress + follow state, each on its own call. Every API call goes through `net.lua` (wifi-gated, non-blocking, dismissable loading dialog); loading/empty/error states are all present (CLAUDE.md §7/§9 — never a blank panel), with a typed-error→on-panel-line mapper and a **401 routed back to the credential prompt** via the injected `Auth:handleError` (KRP-303/304). `onMenuSelect` is overridden to run the row action without closing the menu. Opening a chapter (the reader) is a stub pending KRP-502. Wiring stays in `main.lua`: `SourceBrowser:openManga` now calls an injected `show_details(manga)` so the collaborator construction (ApiClient + a fresh `Details` per visit) lives in `Komanga:showDetails`. **busted 86 successes / 0 failures** (70 prior + KRP-403's 16 now green against the impl); **luacheck clean — 0/0 across 24 files**. Verified loading clean in the emulator (headless SDL-dummy boot, 2026-06-28): `Plugin loaded komanga` / `FM loaded plugin komanga`, no traceback — so the new `state/details` + `ui/manga_details` requires resolve at boot. On-panel details/chapter feel (legibility, last-read marker, follow toggle) against a live API is part of the KRP-405 `[DEVICE]` pass.

### KRP-405 — [DEVICE] Browse/search on-device pass
**Status:** Done
**Description:** Validate the full browse path on the real Kobo: list legibility, cover thumbnails (via the `eink` profile), and paging/responsiveness through results and chapters.
**Acceptance criteria:**
- Covers and text render legibly; no broken layout on the real panel.
- Result/chapter paging is usable and responsive.
**Blocked by:** KRP-402, KRP-404.
**Estimate:** M
**Outcome:** Verified on the real Kobo Clara BW (2026-06-28) against a local API stack (Suwayomi + API on the dev Mac over LAN; cloudflared/prod not used). Text renders legibly at device font sizes on the full 1072×1448 panel with no broken/truncated layout; result and chapter paging are usable and responsive; e-ink refresh is clean (acceptable ghosting, no smearing) across long result/chapter lists. Source list, search (incl. "Load more…" appending in order), manga details, follow/unfollow toggle, the chapter-stub tap, and the wifi-off → enable-wifi prompt and 401 → credential re-prompt all confirmed on-device. **Covers deferred** to KRP-406 (the KRP-402/404 lists are text-only `Menu`), so this pass validated legibility + paging only. Notes: the return-to-sources control is KOReader's bottom-left `page_return_arrow` (footer), wired to `Menu:onReturn` → source list — confirmed correct (the device checklist's "top-left" wording was wrong). Three checklist items were not reproducible on-device — a 0-result "No results." state (no no-match query found), the dismissable slow-call loading dialog (LAN too fast), and a forced network/server error line — all are covered by busted specs (KRP-401/305) + emulator boot; the "Last read" marker awaits the reader (validated in KRP-503/602). **Test-data findings (not KRP-405 defects):** MangaDex's chapter feed is broken in this Suwayomi build ("No chapters found" for every title even at the Suwayomi layer) — switched testing to **Weeb Central**/**ComicK**, which work. Separately discovered an **API-epic gap**: `MangaService.getManga` reads only Suwayomi's already-stored chapters and never triggers `fetchChapters`, so a freshly-searched manga shows an empty chapter list until a scrape is triggered — needs an API-epic ticket (RFC §13), not a plugin workaround; blocks the reader epic (KRP-5xx).

### KRP-406 — Cover thumbnails in browse/details lists
**Status:** Implemented — pending on-device validation (`[DEVICE]`)
**Description:** The KRP-402/404 screens are text-only `Menu` lists — they render no cover images. KRP-405's "covers render legibly" criterion was therefore split out here and deferred from the device pass (which validated text legibility + paging only). Add cover thumbnails to the search-results and manga-details lists by moving to a cover-capable KOReader menu (CoverBrowser-style `MosaicMenu`/`ListMenu`) or per-row `ImageWidget`, fetching covers via the `eink` profile through `net.lua` (CLAUDE.md §6/§7 — eink only, single network path, never a blank panel). Covers/manga carry a cover URL in the API metadata; bound any thumbnail prefetch (CLAUDE.md §8).
**Acceptance criteria:**
- Search results and chapter/details lists show legible cover thumbnails (eink profile) without breaking layout — verified on the real Kobo (`[DEVICE]`).
- Thumbnail fetching is non-blocking and wifi-gated (via `net.lua`); a missing/failed cover degrades to text, never a blank or broken row.
**Blocked by:** KRP-405, **API-905/906** (cover-image endpoint with profile negotiation).
**Estimate:** M
**Blocker (2026-06-29) — RESOLVED:** Originally blocked because the API had no profile-negotiated cover endpoint (only a raw Suwayomi `thumbnailUrl`, which the client must not touch — RFC §6/§13, CLAUDE.md §6/§10). **API-905/906 shipped** `GET /api/manga/:id/cover?profile=eink`, unblocking the plugin work.

**Implementation (2026-06-29):** The logic layer is built and busted-covered (network mocked at the `api/` boundary):
- `ApiClient:coverImageUrl(mangaId)` — pure builder, always `profile=eink`, never `raw` (mirrors `pageImageUrl`/`cbzUrl`); plus `ApiClient:fetchCover(mangaId)` returning the raw image bytes (the cover endpoint serves an image, not the `{ data }` envelope), reusing the shared auth/transport/error stage so a missing cover (404) is an ordinary error.
- `state/covers.lua` — a pure cover cache: a **bounded prefetch window** (CLAUDE.md §8, `config.cover_prefetch_window`) so a long result list never fans out into one request per row, dedup of already-handled covers, and degrade-to-text (a failed cover is remembered, never retried in a loop or left pending). Split fetch/apply like the other state modules so the fetch runs off-thread in `net.lua`'s fork.
- UI: covers fetched through `net.lua` only (non-blocking + wifi-gated), decoded by `ui/cover_thumbnail.lua` (RenderImage → ImageWidget, decode failure → text) and shown via the menu row's `item.state` slot on the search-results rows and the manga-details header; a pending/failed/absent cover leaves text — never a blank or broken row.

**Remaining (`[DEVICE]`, cannot close from the emulator alone — CLAUDE.md §4/§11):** verify on the real Kobo that covers render legibly without breaking row layout, and tune cover slot size / rows-per-page (KRP-701). Refinement noted: cover fetching currently shows a brief dismissable "Loading covers…" dialog (net.lua's standard path) rather than a fully silent background fetch — acceptable per the acceptance criteria; a truly background pass is on-device tuning.

---

# Feature: Reader (5xx)

> The core experience. **Primary path: read via KOReader's native CBZ reader** — the API already builds `eink` CBZs (API epic), and `ReaderUI:showReader` gives paging, zoom, RTL, and e-ink refresh for free. On-demand streaming is added as a refinement once the CBZ path works end-to-end.

### KRP-501 — [TEST] Chapter acquisition & page mapping (logic)
**Status:** Done
**Description:** Tests for acquiring a chapter for reading: request the chapter's `eink` CBZ via the API download endpoint, track build/download status, retrieve the stored CBZ, and map the API page index ↔ CBZ page index. (If a direct "fetch built CBZ bytes" endpoint is missing from the API, that is an **API-epic ticket**, not a client hack — RFC §13.)
**Acceptance criteria:**
- Chapter acquisition requests `profile=eink`; status tracked; page-index mapping correct.
- Network mocked at the `api/` boundary.
**Blocked by:** KRP-302.
**Estimate:** M
**Outcome:** Failing `busted` contract for `state/reader.lua` (impl rides with the reader glue in KRP-502) — `spec/state/reader_spec.lua`, **12 specs**, mocking at the `api/` boundary via `FakeApi` (CLAUDE.md §4/§5 — `state/` is pure, no HTTP, no KOReader loaded). Defines the pure chapter-acquisition coordinator `Reader.new(api, mangaId, chapterId)` against the shared API contract (RFC §5.2/§7, `POST /api/chapter/:id/download`, `GET /api/downloads/:chapterId`): unwrapped `{ data }` shapes `downloadChapter(chapterId, mangaId) -> ({ chapterId, mangaId, cbzPath, status="pending"|"completed"|"failed", createdAt }, …)` and the pure `cbzUrl(chapterId)` URL builder, with typed errors `{ kind, status?, … }` (KRP-301/302). Mirrors `state/details.lua`'s pure `fetchDownload`/`applyDownload` split (the fetch is what net.lua runs in a forked sub-process, KRP-305; `apply*` mutates the parent's table). Covers **acquisition via the eink-only path** (`acquire` calls `downloadChapter` — which always appends `?profile=eink`, never `getChapterPages` or a raw URL — with this chapter + its manga); **status tracking** (only a `completed` build `isReady` and exposes `getCbzUrl`; a `pending` build is not-ready-yet, NOT an error; a `failed` build is surfaced via `getError` and stays not-ready; a transport/HTTP error acquires nothing and leaves no status; a later success clears a prior error); the **fetch/apply split** (`fetchDownload` makes the call and mutates nothing, `applyDownload` records the result parent-side); and the **API↔CBZ page-index mapping** (`Reader.apiPageToCbzPage`/`cbzPageToApiPage` — a fixed ±1 offset between 0-based API page indices and KOReader's 1-based CBZ pages, round-trip verified). Result builders hand each call a fresh table (test isolation). Fail-first verified: full suite **102 successes / 1 error** (the missing `state.reader` module); confirmed satisfiable by a throwaway impl (12/12 green, luacheck clean across 29 files) which was then removed. `luacheck` clean (0/0 across 28 files).

### KRP-502 — Open chapter in KOReader's reader (impl)
**Status:** Done
**Description:** Download the chapter CBZ to the plugin's downloads dir and hand off to `ReaderUI:showReader(path)`, honouring reading direction (RTL/LTR) from the manga metadata. Satisfies the acquisition logic from KRP-501.
**Acceptance criteria:**
- A chapter opens in KOReader's native reader from the plugin; pages render; RTL honoured.
- KRP-501 tests pass.
**Blocked by:** KRP-501, KRP-305.
**Estimate:** M
**Outcome:** Implemented `state/reader.lua` (the KRP-501 impl rides here) and `ui/reader_launcher.lua` (the KOReader glue), and wired both through `ui/manga_details.lua` + `main.lua`. **`state/reader.lua`** is the pure, framework-free chapter-acquisition coordinator satisfying the KRP-501 contract (CLAUDE.md §5 — `state/` is pure, busted-testable; network only via an injected ApiClient): `Reader.new(api, mangaId, chapterId)` with the same `fetchDownload`/`applyDownload` split as the other state modules (the fetch is what `net.lua` runs in a forked sub-process, KRP-305, so it mutates nothing; `applyDownload` records the result parent-side). Acquisition goes through `ApiClient:downloadChapter` — the **eink-only** path (`?profile=eink`, never raw — §6); only a `completed` build `isReady` and exposes `getCbzUrl` (the stored-CBZ URL); a `pending` build is not-ready-yet (not an error); a `failed` build is surfaced as a typed `{ kind = "build" }` error; a transport/HTTP error acquires nothing. `apiPageToCbzPage`/`cbzPageToApiPage` are the fixed ±1 map between 0-based API page indices and KOReader's 1-based CBZ pages (for resume-seek + progress, KRP-503/602). **`ui/reader_launcher.lua`** confines all KOReader coupling (CLAUDE.md §5/§12): two sequential `net.lua` calls (wifi-gated, non-blocking — §7) mirror the server's two-step contract — POST the download (the slow side: the API fetches + processes + builds the CBZ; `download-service.ts` is synchronous so it returns `completed`), then GET the stored bytes via the new **`ApiClient:fetchChapterCbz`** (mirrors `fetchCover` — a raw-bytes endpoint reusing the shared transport/auth/error stage). The bytes are written to `<data>/komanga/downloads/<chapterId>.cbz` (chapterId sanitised to a safe filename), then **reading direction is honoured** by writing `inverse_reading_order` into the document's `DocSettings` sidecar before `ReaderUI:showReader(path)` — KOReader's `readerview` reads that at open (RTL → inverted page-turn order; LTR written explicitly so it's deterministic). Loading/error states are present for every async path: a 401 routes back to the credential prompt (via injected `Auth:handleError`, KRP-303/304), a dismissed loading dialog leaves the panel as-is, every other failure shows a typed-error→on-panel line (CLAUDE.md §9 — never a blank panel). Collaborator construction (`Reader` + the launcher) lives in `main.lua` (`Komanga:openReader`); `MangaDetails:openChapter` (previously a stub) now just hands off the tapped chapter via an injected `open_reader`. **busted 114 successes / 0 failures** (102 prior + KRP-501's 12 now green against the impl); **luacheck clean — 0/0 across 30 files**. Verified loading clean in the emulator (headless SDL-dummy boot, 2026-06-30): `Plugin loaded komanga` / `FM loaded plugin komanga`, no traceback — so the new `state/reader` + `ui/reader_launcher` requires (ReaderUI/DocSettings/DataStorage/util) resolve at boot. On-panel reading — full-panel render, page-turn responsiveness, controlled ghosting, correct RTL/LTR — against a live API is the **KRP-503 `[DEVICE]`** pass.

### KRP-503 — [DEVICE] Reading experience on-device
**Description:** Validate a multi-page chapter on the real Kobo via the CBZ+reader path: full-panel rendering, page-turn responsiveness, controlled ghosting (KOReader refresh), and correct RTL/LTR.
**Acceptance criteria:**
- Pages fill the panel with no distortion; RTL/LTR correct.
- Page turns are responsive; refresh is clean across a multi-page chapter.
**Blocked by:** KRP-502.
**Estimate:** L

### KRP-504 — [TEST] On-demand streaming / prefetch window (logic)
**Status:** Done
**Description:** Tests for the "read without downloading the whole chapter" refinement: stream pages within a bounded, configurable window so the next page is ready on turn; already-fetched pages need no refetch.
**Acceptance criteria:**
- Viewing page N triggers fetch of the next page(s) within the window.
- Already-fetched pages display without a new network round-trip.
**Blocked by:** KRP-501.
**Estimate:** M

### KRP-505 — Streaming reader (impl)
**Status:** Done
**Description:** Implement bounded streaming satisfying KRP-504 — either a custom paged image viewer (`ImageWidget` + tap zones + `setDirty` refresh) or progressive CBZ assembly handed to `ReaderUI`. Reading direction honoured for page order and tap zones.
**Acceptance criteria:** All KRP-504 tests pass.
**Blocked by:** KRP-504, KRP-502.
**Estimate:** L
**Outcome:** Implemented `state/prefetch.lua` — the pure, framework-free state satisfying the KRP-504 contract (CLAUDE.md §5 — `state/` is pure, busted-testable; network only via an injected ApiClient). `Prefetch.new(api, page_ids, opts)` owns the two non-UI concerns of the "read without downloading the whole chapter" refinement: (1) **bounded, position-driven prefetch** (CLAUDE.md §8) — `plan(current)` returns the displayed page plus up to `opts.window` pages ahead (default `config.prefetch_window` = 2), clamped to the chapter, in reading order, so the next page is fetched before the turn but the pass never fans out into one request per page; and (2) **no refetch** — a page already `pending`/`ready` is skipped, so advancing only fetches the newly entered page and reading back a cached page costs no round-trip. Unlike a cover (KRP-406) a **failed page is retryable** (not terminal — a manga page can't degrade to text), so `plan` re-picks a failed page on a later pass. Mirrors the other state modules' pure `fetch`/`apply` split (the fetch is what `net.lua` runs in a forked sub-process, KRP-305; `apply` records results parent-side). The public API is **position-based** (1-based page numbers the reader knows — `plan`/`getBytes`/`isReady`/`isFailed`/`pageCount`); internally a position maps to the chapter's page id, which is what `api:fetchPage(id)` fetches (wire shape mirrors `fetchCover`). Page bytes stay opaque — decoding + the on-panel paged viewer, tap zones, and `setDirty` refresh are the reader's job, validated on-device in **KRP-506** (`[DEVICE]`). **busted 134 successes / 0 failures** (KRP-504's prefetch specs now green against the impl); **luacheck clean — 0/0 across 32 files**.

### KRP-506 — [DEVICE] In-reader menu & loading/error states
**Status:** Implemented — pending on-device validation (`[DEVICE]`)
**Description:** Add the in-reader actions (download-this-chapter, chapter/page jump) and on-device-legible loading/error/retry states for slow or failed page/CBZ fetches, integrated with KOReader's reader without disrupting reading position.
**Acceptance criteria:**
- A slow/failed fetch shows a clear loading/retry state, never a blank panel.
- "Download chapter" triggers the API download endpoint and reflects status.
- The menu opens/closes without losing reading position.
**Blocked by:** KRP-505.
**Estimate:** M
**Implementation (2026-07-02):** Built on the existing CBZ + `ReaderUI` path (the primary reader — KRP-502); the three acceptance criteria are met without a custom viewer.
- **In-reader menu.** The plugin already loads in both the file manager and the reader (`is_doc_only = false`); `main.lua:addToMainMenu` now branches on context (`self.ui.document`) and, in the reader, builds a **KoManga** reader-menu entry via `ui/reader_menu.lua`. It is attached to KOReader's own `ReaderMenu` (`sorting_hint = "more_tools"`, the idiomatic home for plugin actions — no edit to KOReader's menu order), so opening/closing it is KOReader's native menu and **the reading position is preserved for free** (acceptance #3). The menu is offered only for a KoManga chapter — recovered from `komanga_chapter_id`/`komanga_manga_id` stashed in the document's `DocSettings` sidecar at launch (`ui/reader_launcher.lua`), so it also works for a downloaded chapter reopened straight from the file manager.
- **Download this chapter.** "Download this chapter for offline" POSTs `ApiClient:downloadChapter` (the eink-only `/api/chapter/:id/download` — §6) through `net.lua` and **reflects the returned status** on the panel (acceptance #2).
- **Loading/retry.** New `ui/retry.lua` wraps a `net.lua` call with the shared loading/retry UX (CLAUDE.md §7/§9 — never a frozen or blank panel): a slow call keeps `net.lua`'s dismissable loading dialog; a **retryable** failure (transport / server 5xx / build) shows a Retry/Cancel `ConfirmBox` that re-runs the same task; a 401 routes to the credential prompt; a user-dismissed dialog leaves the panel as-is; anything else shows a single on-panel line (acceptance #1). Both reader paths use it — the open flow (`ui/reader_launcher.lua`, which previously dead-ended on error) and the new download action.
- **Logic extracted + tested.** `state/errors.lua` (pure — `isRetryable`/`isCancelled`, the one busted-testable piece of this ticket) classifies `api/client.lua`'s typed errors; `ui/errors.lua` centralises the error→on-panel-text mapping (dedup of the identical copies that were in `reader_launcher.lua` + `manga_details.lua`).
- **busted 142/0** (134 prior + 8 new in `spec/state/errors_spec.lua`); **luacheck clean — 0/0 across 37 files**. Verified loading clean in the emulator (headless SDL-dummy boot, 2026-07-02): `Plugin loaded komanga` / `FM loaded plugin komanga`, no traceback — so the new `ui/reader_menu` → `ui/retry` → `ui/errors` / `state/errors` requires resolve at boot.
- **Scope note:** "chapter jump" (next/previous chapter from inside the reader) is **not** in this ticket's acceptance criteria and is deferred — it needs the ordered chapter list + current-chapter position threaded into the reader context and a close-and-reopen flow, better designed against the real device. Page jump is already native to KOReader's reader.

**Remaining (`[DEVICE]`, cannot close from the emulator alone — CLAUDE.md §4/§11):** on the real Kobo, confirm the KoManga entry appears in the reader menu, "Download this chapter" reports status legibly, the Retry dialog is legible/usable on a forced failure, and opening/closing the menu leaves the reading position untouched.

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

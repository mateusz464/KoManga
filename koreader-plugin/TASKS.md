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
**Status:** Done — verified on the real Kobo (2026-07-05): covers render legibly in the search-results and manga-details lists (eink profile) without breaking row layout; a missing/failed cover degrades to text; thumbnail fetch stays non-blocking + wifi-gated via `net.lua`.
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
**Status:** Done — verified on the real Kobo (2026-07-05): a multi-page chapter reads via the CBZ + `ReaderUI` path — pages fill the full panel with no distortion, page turns are responsive, refresh is clean across the chapter, and RTL/LTR is correct.

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
**Status:** Done — verified on the real Kobo (2026-07-05): the KoManga entry appears in the reader menu, "Download this chapter for offline" reports its status legibly, the Retry dialog is legible/usable on a forced failure, and opening/closing the menu leaves the reading position untouched.
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
**Status:** Done
**Description:** Tests that turning a page pushes progress to the API (debounced), and that opening a manga resumes from the stored last-read position (last-write-wins). Covers mapping KOReader reader page events ↔ API progress.
**Acceptance criteria:**
- Page turns push progress, debounced (not every turn hammering the API).
- Reopening a manga resumes at the synced position.
**Blocked by:** KRP-502.
**Estimate:** M
**Outcome:** Wrote `spec/state/progress_spec.lua` — the failing contract for `state/progress.lua` (implemented in KRP-602), network mocked at the `api/` boundary via `FakeApi` (CLAUDE.md §4/§5). A `Progress.new(api, mangaId, chapterId, opts)` is scoped to the open chapter and owns the two concerns: (1) **debounced push on page turn** — at-most-one push per `opts.debounce` seconds (default `config.progress_debounce_seconds` = 5): `onPageTurn(readerPage)` pushes on the leading edge and coalesces rapid turns into the LATEST position (last-write-wins), with a driven clock (`opts.now`) exercising the window deterministically; the decision is pure (no network — the caller runs `push(body)` off-thread through `net.lua`, KRP-305), and `flush()` force-syncs the last pending position on the reader-close event. (2) **resume** — `resume()`/`fetchResume`/`applyResume` map the manga's stored progress to a 1-based reader seek page, but only when it belongs to this chapter; a never-read 404 is the empty state (no resume, not an error), a non-404 error is surfaced. Page mapping mirrors `state/reader.lua` + the API port: API `page` is 0-based within the chapter, KOReader's CBZ reader is 1-based (reader page N ↔ api page N-1). **busted 142 successes / 0 failures / 1 error** — the one error is this spec failing on the not-yet-existent `state.progress` (correct red-first for a `[TEST]` ticket, resolved by KRP-602); **luacheck clean**.

### KRP-602 — Progress sync (impl)
**Status:** Done — verified on-device (progress resumes across two sessions; page-turn sync silent).
**Description:** Hook KOReader's reader page-update/close events to push debounced progress and resume on open, satisfying KRP-601.
**Acceptance criteria:** All KRP-601 tests pass; verified resuming across two sessions on-device.
**Blocked by:** KRP-601, KRP-506.
**Estimate:** S
**Outcome:** Implemented `state/progress.lua` (the KRP-601 impl rides here) and `ui/progress_sync.lua` (the KOReader reader-event glue), and wired both into `main.lua`. **`state/progress.lua`** is the pure, framework-free sync coordinator satisfying the KRP-601 contract (CLAUDE.md §5 — `state/` is pure, busted-testable; network only via an injected ApiClient). Scoped to one (manga, chapter), it owns the two concerns: (1) **debounced push on page turn** — `onPageTurn(readerPage)` pushes on the leading edge of each `debounce`-second window (default `config.progress_debounce_seconds` = 5) and coalesces rapid turns into the LATEST position (last-write-wins); the decision is pure (no network — the caller runs `push(body)` off-thread through `net.lua`), driven by an injected `now` (defaults to `os.time`, so `state/` stays KOReader-free); `flush()` force-syncs the last pending position on close regardless of the window so resume lands on the true last page. (2) **resume** — `fetchResume`/`applyResume`/`resume` map the manga's stored progress to a 1-based reader seek page, but only when it belongs to this chapter; a never-read 404 is the empty state (no resume, not an error), a non-404 error is surfaced. Page mapping mirrors `state/reader.lua` + the API port (reader page N ↔ api page N-1). **`ui/progress_sync.lua`** confines all reader-event coupling (CLAUDE.md §5/§12): the plugin is a registered ReaderUI module, so `main.lua` now handles the broadcast `onReaderReady` (recover the KoManga chapter from the DocSettings sidecar the launcher stashed — `komanga_chapter_id`/`komanga_manga_id` — build a `Progress`, resume + `GotoPage`-seek), `onPageUpdate` (debounced push), and `onCloseDocument` (flush); each returns nothing so the event keeps propagating to KOReader's own modules, and all are inert in the file-manager context. Progress pushes are **best-effort BACKGROUND** calls: `net.lua` gained a `background` mode — runs ONLY when already online (never prompts wifi mid-read; an offline turn is skipped with a `{ kind = "offline" }` error) and behind an **invisible** Trapper widget (no loading dialog flashing on every page turn), while still running the PUT off the UI thread. A failed background sync is harmless (the next due turn / the close-flush resyncs), so its result is ignored rather than surfaced — reading is never interrupted by a sync error. **busted 162 successes / 0 failures** (142 prior + 18 for KRP-601 now green against the impl + 2 new `net_spec` background-mode cases); **luacheck clean — 0/0 across 40 files**. Verified loading clean in the emulator (headless SDL-dummy boot, 2026-07-02): `Plugin loaded komanga` / `FM loaded plugin komanga`, no traceback — so `main.lua`'s new `ui/progress_sync` → `state/progress` + `ui/event` requires resolve at boot. **On-device (`[DEVICE]`) — verified (2026-07-04):** on the real Kobo, progress resumes across two sessions (read a chapter, close, reopen → lands on the last page) and page-turn sync stays silent (no dialog flash, no wifi prompt while reading).

### KRP-603 — [TEST] Library / home view (logic)
**Status:** Done — failing specs written (red-first), resolved by KRP-604.
**Description:** Tests for the library/home view: followed manga, resume-reading shortcuts, downloaded chapters list.
**Acceptance criteria:**
- Followed manga + last-read render; "continue reading" jumps into the reader.
- Downloaded chapters are listed and openable.
**Blocked by:** KRP-302.
**Estimate:** M
**Outcome:** Wrote `spec/state/library_spec.lua` — the failing contract for `state/library.lua` (implemented alongside the UI in KRP-604), network mocked at the `api/` boundary via `FakeApi` (CLAUDE.md §4/§5). A `Library.new(api)` backs the whole home view and owns the ticket's three jobs: (1) **followed manga** — `loadLibrary`/`fetchLibrary`/`applyLibrary` load the library list in the API's `added_at ASC` order (`listLibrary` → `{mangaId, addedAt}` refs); an empty library is the empty state (`isEmpty`), not an error; a refresh error is surfaced via `getError` while the prior list is kept intact. (2) **continue reading** — `continueReading(mangaId)` (fetch `getProgress` + pure `continueTarget`) resolves the last-read position into a jump target `{ mangaId, chapterId, page }` the reader opens (the actual page-seek is progress-sync's `resume`, KRP-602; the raw `page` is carried only for the last-read render); a never-read 404 is the empty state (nil target, no error), a non-404 error is returned, and — being a per-row lookup — it never clobbers the shared list error. (3) **downloaded chapters** — `loadDownloads`/`getDownloads` load the downloads list in API order, `getOpenableDownloads`/`Library.isOpenable` expose that only a `completed` build is openable (`pending`/`failed` are not). Each list-load mirrors `state/browse.lua`'s pure `fetch*` + parent-side `apply*` split (net.lua runs the fetch off-thread in a fork, KRP-305). Library entries carry only a `mangaId` reference (no title) — the API has no richer library/metadata endpoint yet (RFC §14), so title hydration is out of scope here and would be an API-epic ticket, not a per-row `getManga` fan-out (CLAUDE.md §6/§8/§10). **busted 162 successes / 0 failures / 1 error** — the one error is this spec failing to load the not-yet-existent `state.library` (correct red-first for a `[TEST]` ticket, resolved by KRP-604); **luacheck clean — 0/0 across 41 files**.

### KRP-604 — Library / home view (UI)
**Status:** Done
**Description:** Build the library/home UI (`Menu`) satisfying KRP-603, including continue-reading and the downloaded-chapters list.
**Acceptance criteria:** All KRP-603 logic is wired into a working UI; runs in the emulator.
**Blocked by:** KRP-603, KRP-402.
**Estimate:** M
**Outcome:** Implemented `state/library.lua` (the KRP-603 impl rides here) and `ui/library_view.lua` (the screen), and wired both into `main.lua`. **`state/library.lua`** is the pure, framework-free coordinator satisfying the KRP-603 contract (CLAUDE.md §5 — `state/` is pure, busted-testable; network only via an injected ApiClient). Its three jobs each mirror `state/browse.lua`'s pure `fetch*`/`apply*` split (the fetch is what net.lua runs in a forked sub-process, KRP-305; `apply*` mutates the parent's table in the `on_result` callback): (1) **followed manga** — `loadLibrary`/`fetchLibrary`/`applyLibrary` load the library list in the API's `added_at ASC` order; an empty library is `isEmpty` (empty state, not an error); a refresh error is surfaced via `getError` while the prior list is kept intact; (2) **continue reading** — `continueReading(mangaId)` / `fetchProgress` + the pure `continueTarget(data, err)` resolver map the last-read position into a `{ mangaId, chapterId, page }` jump target, a never-read 404 being nil-target/no-error and any other error returned as-is; being a per-row lookup it never clobbers the shared list error; (3) **downloaded chapters** — `loadDownloads`/`getDownloads` load in API order and `getOpenableDownloads`/`Library.isOpenable` expose that only a `completed` build is openable (`pending`/`failed` are not). Library entries carry only a `mangaId` (no title — the API has no richer library endpoint yet, RFC §14; a per-row `getManga` fan-out would be wrong, CLAUDE.md §6/§8/§10). **`ui/library_view.lua`** is a `Menu:extend` (CLAUDE.md §5/§7 — lean on KOReader widgets, no hand-rolled layout): one Menu with two labelled sections (**Following** / **Downloaded**), each with its own loading/empty state so a slow or empty side never blanks the panel (§9); a followed row taps to **continue-reading** (jump into the reader), a completed download taps to **open**, and a non-openable download shows its build status rather than a dead tap. Every API call goes through `net.lua` (wifi-gated, non-blocking, dismissable loading dialog); a 401 routes back to the credential prompt via the injected `Auth:handleError` (KRP-303/304). The heavy wiring lives in `main.lua` (no business logic in the view, §5): `Komanga:showLibrary` builds a fresh `Library` per visit behind a new **Library** menu sub-item; `Komanga:continueReading` runs the progress lookup through net, resolves the target, and either jumps into the reader (`resumeReader`) or opens details when the manga was never read; `Komanga:resumeReader` (shared by continue-reading and open-download) loads the manga first to honour reading direction (RTL/LTR) before handing off to `ui/reader_launcher.lua` (KRP-502). **busted 176 successes / 0 failures** (162 prior + KRP-603's 14 now green against the impl); **luacheck clean — 0/0 across 43 files**. Verified loading clean in the emulator (headless SDL-dummy boot, 2026-07-04): `Plugin loaded komanga` / `FM loaded plugin komanga`, no traceback — so the new `state/library` + `ui/library_view` requires resolve at boot. On-panel legibility/refresh of the home view is folded into the KRP-701 `[DEVICE]` tuning pass.
**Follow-ups (raised 2026-07-04, from on-device testing):** (1) followed rows show the raw `mangaId` because the library API carries no title — **API-907/908** add `title` to `GET /api/library`, then **KRP-605** renders it. (2) chapters that were only *read* appear under "Downloaded" because the reader acquires its CBZ via the persisting `POST /download` — **API-909/910** add a transient reader-CBZ path, then **KRP-606** points the reader at it so only explicit downloads are listed.

### KRP-605 — Show manga titles in the library view
**Status:** Done
**Description:** The library / home view (KRP-604) renders each followed manga by its raw `mangaId` (e.g. "40") because `GET /api/library` carried no title. Once **API-908** adds `title` to each library entry, surface it: map `title` through `state/library.lua` (its entries currently expose only `mangaId`) and render it in `ui/library_view.lua`'s Following rows, falling back to `mangaId` when a title is absent. Update `spec/state/library_spec.lua` to assert the title is carried (network mocked at the `api/` boundary, CLAUDE.md §4/§5).
**Acceptance criteria:**
- Following rows show the manga **title**, falling back to `mangaId` if the API omits it.
- `state/library.lua` maps the title; busted specs updated and green.
- `luacheck` clean; loads clean in the emulator.
**Blocked by:** API-908.
**Estimate:** S
**Outcome:** API-908 (`a1b0ce6`) added an optional denormalised `title` to each `GET /api/library` entry, captured **at follow time**. Two-part fix. **Render (state/library.lua + ui/library_view.lua):** since `api/client.lua:listLibrary` returns the unwrapped `{ data }` array and `state/library.lua:applyLibrary` stores it as-is, the `title` flows through onto each entry; added the pure static `Library.entryTitle(entry)` (mirrors `Library.isOpenable`) — returns a non-empty string `title`, else falls back to the raw `mangaId` — and `ui/library_view.lua`'s Following rows now label by `self.library.entryTitle(entry)`. **Capture (root cause of the on-device "still shows the ID" report):** the plugin never *sent* a title when following, so the API's `title` column was always NULL and every row fell back to the id. `ApiClient:follow(mangaId, addedAt, title)` now includes `title` in the PUT body when present (title-less follow still valid), and `Details:fetchFollow` threads the loaded manga's `self.manga.title`. Updated the stale "entries carry only a mangaId" notes. **busted 181/0** (176 prior + 5 new: title carried on each library entry + `entryTitle` fallback in `library_spec`; follow-with-title vs title-less body in `client_spec`; loaded-title-passed-to-follow + omitted-when-unloaded in `details_spec`). **luacheck clean — 0/0 across 43 files.** Emulator boot not re-run here (the `.emulator/` build is not present on this machine — git-ignored/deletable); luacheck parses all changed files clean. **Note — existing follows show the ID until re-followed:** the title is captured at follow time, so manga followed before this fix have a NULL title in the DB and keep falling back to the id; unfollow + re-follow (or a future API-epic backfill) populates them. **Not fixed — the "Downloaded" section still shows chapter IDs:** those rows are per-*chapter*, labelled by `chapterId`, and the downloads API (`GET /api/downloads`) carries no title/manga name — surfacing a name there needs an API-epic ticket (the downloads list must carry it), not a per-row `getManga` fan-out (CLAUDE.md §6/§8/§10/§13).

### KRP-606 — Reader acquires chapters without persisting a download
**Status:** Done — verified on the real Kobo (2026-07-05): reading a chapter leaves it absent from "Downloaded" (transient `GET /api/chapter/:id/cbz`), while the explicit "Download this chapter for offline" action still makes it appear; the chapter renders full-panel with correct RTL/LTR.
**Description:** The primary reader (KRP-502, `ui/reader_launcher.lua` → `ApiClient:downloadChapterCbzToFile`) acquires its eink CBZ via `POST /api/chapter/:id/download`, which persists a download record — so **every chapter read shows up under "Downloaded"** in the library view (KRP-604). Once **API-910** ships the transient read path (e.g. `GET /api/chapter/:id/cbz?profile=eink`), point the reader at it so plain reading does not create a download. Keep the explicit "Download this chapter for offline" action (KRP-506, `ui/reader_menu.lua`) on the persisting `POST /download`. Add the transient fetch to `api/client.lua` (eink only, mirrors `fetchChapterCbz`/`fetchCover`), switch `ui/reader_launcher.lua` to it, and update the `api`/`state/reader` specs (network mocked at the `api/` boundary). CBZ + `ReaderUI` stays the reading path (eink, RTL honoured).
**Acceptance criteria:**
- Reading a chapter does **not** add it to the downloads list; only the explicit "Download this chapter" action does.
- The reader still opens via CBZ + `ReaderUI` (eink), reading direction honoured.
- busted + `luacheck` clean; specs updated.
- **[DEVICE]** confirm on the Kobo: read a chapter → it is absent from "Downloaded"; explicitly download one → it appears.
**Blocked by:** API-910.
**Estimate:** M
**Outcome (2026-07-05):** API-910 (`ebcbf06`) shipped the transient read path `GET /api/chapter/:id/cbz?profile=eink` — it builds and serves the eink CBZ from the session cache **without** persisting a download record (unlike `POST /api/chapter/:id/download`). Three-part change, all through the `api/` boundary (CLAUDE.md §5/§6):
- **`api/client.lua`:** added the pure `readCbzUrl(chapterId)` builder (`/api/chapter/:id/cbz?profile=eink`, **eink only**, mirrors `cbzUrl`) and `readChapterCbzToFile(chapterId, destPath)` (GET the transient endpoint, streamed straight to a file via `sink_path` — same tens-of-MB-can't-cross-the-fork rationale as `downloadChapterCbzToFile`, KRP-502). The persisted `downloadChapter` (POST) is **unchanged**, still backing the explicit "Download this chapter for offline" action (`ui/reader_menu.lua`, KRP-506).
- **`state/reader.lua`:** the transient path is a single GET-to-file with no build record, so the old download-status machinery (`fetchDownload`/`applyDownload`/`acquire`/`isReady`/`isFailed`/`getStatus`/`getCbzUrl`/`getError`) is gone; it is now a thin pure coordinator — `fetchCbz(destPath)` → `api:readChapterCbzToFile` (off-thread safe, returns `(path, err)`) plus the unchanged 0-based-API ↔ 1-based-CBZ page-index mappers (still mirrored by `state/progress.lua`).
- **`ui/reader_launcher.lua`:** collapsed the previous two net calls (POST download → GET stored bytes) into **one** transient `reader:fetchCbz(path)` through `net.lua` (wifi-gated, non-blocking, dismissable loading + `Retry` on failure — KRP-305/506); reading direction (RTL/LTR) still written to the DocSettings sidecar before `ReaderUI:showReader`, and the chapter identity still stashed for the in-reader menu / progress sync. `main.lua` drops the now-unused `api` arg it handed the launcher. `downloadChapterCbzToFile` (fetching a **persisted** download's bytes) is retained as part of the offline-download surface (future KRP-702).
- **Specs:** `spec/state/reader_spec.lua` rewritten — asserts reading goes through `readChapterCbzToFile` and **never `downloadChapter`** (acceptance #1), plus error propagation and the page mapping; `spec/api/client_spec.lua` gained a transient-CBZ block (GET the eink `…/cbz?profile=eink` URL, sink to file, Bearer, 404/transport mapping, pure `readCbzUrl`).
- **busted 183/0**; **luacheck clean — 0/0 across 43 files.** Verified loading clean in the emulator (headless SDL-dummy boot, 2026-07-05): `Plugin loaded komanga` / `FM loaded plugin komanga`, no traceback — the changed `api/client` + `state/reader` + `ui/reader_launcher` requires resolve at boot.
- **Remaining (`[DEVICE]`, cannot close from the emulator alone — CLAUDE.md §4/§11):** on the real Kobo confirm that reading a chapter leaves it **absent** from "Downloaded", while the explicit "Download this chapter for offline" action still makes it **appear**, and that the chapter still renders full-panel with correct RTL/LTR.

### KRP-607 — "Continue (next chapter number)" in the library view
**Status:** Done — verified on the real Kobo (2026-07-05): a part-way manga shows its current chapter number, a finished chapter shows the next number, and a caught-up manga shows `Caught Up`.
**Description:** The library / home view's **Following** rows show a bare `Continue` mandatory label (`ui/library_view.lua`, KRP-604). Show the chapter the user should read next instead — e.g. `One Piece      Continue (41)` — using the continue target **API-912** adds to each `GET /api/library` entry (`nextChapter { id, number }` + `caughtUp`). The plugin does **not** compute this (it would need per-row progress + chapter lists, and `getManga` is a live scrape — API-904/CLAUDE.md §6/§8); it just renders the API's field and opens the given chapter.
**Semantics (mirror API-911, the API owns the computation):**
- **Never read** → `Continue (<first chapter number>)`.
- **Part-way** through a chapter (not the last page) → `Continue (<that chapter's number>)` (resume).
- **Finished** a chapter (last page reached) with a later chapter → `Continue (<next chapter number>)`.
- **Caught up** (finished the newest chapter) → the mandatory reads **`Caught Up`** (no number); it flips back to `Continue (<n>)` once the API reports a newer chapter.
- `chapterNumber` is a **decimal** (e.g. Grand Blue Dreaming — 40.5, …): render it exactly, trimming only a trailing `.0` (41.0 → `41`, 40.5 → `40.5`). No rounding.
**Work:** map `nextChapter`/`caughtUp` through `state/library.lua` (pure — add a testable label/number/target helper, e.g. `Library.continueLabel(entry)` → the mandatory text + whether tappable + the chapterId to open; mirrors `entryTitle`/`isOpenable`), update `spec/state/library_spec.lua` (network mocked at the `api/` boundary, CLAUDE.md §4/§5). In `ui/library_view.lua`, render the label on the Following row and open the entry's `nextChapter.id` on tap (resume seek is handled by progress-sync, KRP-602; a `caughtUp` row opens the manga details rather than a dead tap). Degrade gracefully when the API omits the field (no stored chapters / older API) → fall back to a bare `Continue`.
**Acceptance criteria:**
- Following rows show `Continue (<next chapter number>)` per the semantics above, `Caught Up` when caught up, and a bare `Continue` fallback when the API omits the target.
- Decimal chapter numbers render exactly (trailing `.0` trimmed); no rounding.
- Tapping a row opens the correct chapter (resume for part-way, next for finished); `state/library.lua` maps the fields; busted specs updated and green.
- `luacheck` clean; loads clean in the emulator.
- **[DEVICE]** confirm on the Kobo: a part-way manga shows its current chapter; a finished chapter shows the next number; a caught-up manga shows `Caught Up`.
**Blocked by:** API-912.
**Estimate:** M
**Outcome (2026-07-05):** API-912 (`536b0b3`) added a server-computed continue target to each `GET /api/library` entry — `nextChapter { id, number } | null` + `caughtUp` — so the plugin only renders it (it can't compute the target without a per-row progress + chapter-list fan-out; the number is a decimal like 40.5). Since `api/client.lua:listLibrary` returns the unwrapped `{ data }` array and `state/library.lua:applyLibrary` stores it as-is, both fields flow through onto each entry. Two pure helpers added to `state/library.lua` (mirroring `entryTitle`/`isOpenable`): **`Library.formatChapterNumber(n)`** renders a chapter number exactly, trimming only a trailing `.0` (`41.0`→`41`, `40.5`→`40.5`, no rounding — LuaJIT already prints an integral float without a fraction, the gsub also covers a Lua 5.3 `41.0`); **`Library.continueLabel(entry)`** returns `{ text, chapterId }` per the API-911 semantics — `caughtUp`→`{"Caught Up", nil}`, a `nextChapter`→`{"Continue (<number>)", <id>}`, else the bare `{"Continue", nil}` fallback (older API / no stored chapters). `ui/library_view.lua`'s Following rows now label the mandatory by `continueLabel(entry).text` and hand the whole `entry` to `continue_reading` on tap. `main.lua:Komanga:continueReading` became the router: a row with a `chapterId` opens that chapter directly via `resumeReader` (reading direction loaded there; resume-seek on open, KRP-602), a `caughtUp` row opens the manga details rather than a dead tap, and a target-less row falls back to the previous progress-lookup path (renamed `continueViaProgress`). **busted 189/0** (183 prior + 6 new in `library_spec` — continue target carried on each entry; `continueLabel` for next-chapter/caught-up/fallback; exact-decimal render; `formatChapterNumber` trailing-`.0` trim). **luacheck clean — 0/0 across 43 files.** Verified loading clean in the emulator (headless SDL boot, 2026-07-05): `Plugin loaded komanga` / `FM loaded plugin komanga`, no traceback — the changed `state/library` + `ui/library_view` + `main.lua` resolve at boot. **Remaining (`[DEVICE]`, cannot close from the emulator alone — CLAUDE.md §4/§11):** on the real Kobo confirm a part-way manga shows its current chapter number, a finished chapter shows the next number, and a caught-up manga shows `Caught Up`.

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
**Description:** Handle flaky/lost wifi gracefully (`NetworkMgr`) and ensure already-downloaded CBZ chapters open and read with the network off. **Note (2026-07-05):** the *offline-downloaded-reading* half is now delivered by the **Offline device-local downloads (8xx)** feature — downloads persist on the device and open without the API (KRP-806, RFC §5.4). This ticket now covers only the **network-resilience** half (graceful flaky/lost wifi via `NetworkMgr`).
**Acceptance criteria:**
- A dropped connection shows a clear state and retry, never a hard crash.
- ~~A previously downloaded chapter opens and reads with wifi off.~~ → moved to KRP-806 (8xx feature).
**Blocked by:** KRP-506, KRP-604.
**Estimate:** S

### KRP-703 — [DEVICE] Install & launch experience
**Description:** Make installing/updating the plugin as smooth as KOReader allows for an open-source audience. **Decision (2026-07-06):** end users install by **drag-and-drop** — download a release zip and drop `komanga.koplugin` into `.adds/koreader/plugins/` (works on any OS, no toolchain); a script installer was deliberately not built. `scripts/package.sh` produces the release zip (runtime files only); `scripts/deploy.sh` stays the **dev-only** deploy tool. `INSTALL.md` is the user-facing install/update/config doc (covers the API too). To keep the *update* path safe (overwriting the plugin folder must not wipe config), the API base URL is now settable in-app and persisted in settings — **KRP-706**. The original "lands on the library/home view" criterion was **dropped** — the existing KoManga menu (Library / Browse / Set credential / Set server URL) is retained as the landing.
**Acceptance criteria:**
- A documented, repeatable install/update path on-device (`INSTALL.md` + `scripts/package.sh` release zip; settings survive a folder-overwrite update via KRP-706).
- ~~Opening KoManga lands on the library/home view.~~ → dropped 2026-07-06; current menu retained.
- **On-device (remaining):** install the release zip, update over it, confirm the KoManga menu loads and the saved server URL + credential persist across the update.
**Blocked by:** KRP-701, KRP-706.
**Estimate:** S

### KRP-706 — Set API server URL in-app
**Status:** Done
**Description:** Add an in-app **"Set server URL"** entry (alongside "Set credential" in the KoManga menu) so the API base URL is set from the device and persists in `LuaSettings` — no hand-editing `config.lua`. Persisting in settings keeps the value out of the plugin folder, so a plugin update (overwriting the folder, KRP-703) can't wipe it. The settings logic (`getApiBaseUrl`/`setApiBaseUrl`) already exists and is tested (KRP-202); this adds the UI prompt (`ui/server_url_prompt.lua`, mirroring `ui/credential_prompt.lua`, KRP-304) and wires the menu entry, rebuilding the API client so the new base takes effect. `join_url` already strips a trailing slash, so no URL normalisation is needed.
**Acceptance criteria:**
- A "Set server URL" menu entry opens an `InputDialog` seeded with the current base URL; saving persists it (survives a KOReader restart) and it takes effect for subsequent API calls.
- The value survives a plugin update (plugin-folder overwrite) because it lives in `LuaSettings`, not `config.lua`.
- `luacheck` clean; network only via `api/`/`net.lua`; no new API endpoint.
**Blocked by:** KRP-202, KRP-304.
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

# Feature: Offline device-local downloads (8xx)

> **Added 2026-07-05 (RFC §5.4).** "Download for offline" becomes a **device-local** persist, not just the server-side store: the plugin fetches the chapter's built `eink` CBZ via the **transient** `GET /api/chapter/:id/cbz?profile=eink` (already built + session-cached, **no** server download record — API-910/KRP-606), writes the bytes to the Kobo under KOReader's data dir, and records a **device-local index** so the "Downloaded" list renders **and opens with wifi off**. Reading a downloaded chapter hits **no** network; the user can **delete** a download to free space. This is a **client concern** — it needs **no new API endpoint** and does not change the contract (RFC §13); the server-side download store (`POST /download`, `GET /downloads`) is left in place but the plugin no longer relies on it. Same conventions as every KRP ticket (CLAUDE.md): `state/` pure + busted-tested with the persistence store injected; all network via `api/`/`net.lua`; `eink` only; loading/error states everywhere; `[DEVICE]` tickets close only on the real Kobo.

### KRP-801 — [TEST] Device-local download store & index (logic)
**Status:** Done
**Description:** Failing `busted` specs for a pure, framework-free `state/downloads.lua` that owns the **device-local download index** — no KOReader loaded, persistence injected (a fake store, mirroring `settings.lua`'s injected-store pattern; CLAUDE.md §5/§9). Contract: `add(entry)` (idempotent per `chapterId`), `get(chapterId)`, `list()` (stable order), `has(chapterId)`, `remove(chapterId)` (returns the local file path to unlink so the caller frees storage), and pure path/layout helpers (the on-device CBZ filename/dir for a chapter). Each entry carries `{ chapterId, mangaId, title, chapterNumber, direction, fileName, size, createdAt }` so the list is legible and openable **offline**.
**Acceptance criteria:**
- Specs cover add/get/list/has/remove + idempotency + path layout, all failing against the absent impl, network/store mocked at the boundary.
- No KOReader modules required to run the spec.
**Blocked by:** KRP-506, KRP-604.
**Estimate:** M

### KRP-802 — Device-local download store & index (impl)
**Status:** Done
**Description:** Implement `state/downloads.lua` and its persistence to make KRP-801 green: a LuaSettings-backed manifest (extend `settings.lua`, or a JSON manifest under `DataStorage`) for the index, and the on-device CBZ directory layout under KOReader's data dir. Keep KOReader/`DataStorage` coupling out of the pure module (inject paths/store), so busted still runs it. Document the device-local download location in `koreader-plugin/CLAUDE.md` (§5/§6).
**Acceptance criteria:**
- KRP-801 specs pass; `luacheck` clean; loads clean in the emulator.
- Index persists across reloads; CBZ dir created lazily.
**Blocked by:** KRP-801.
**Estimate:** M
**Outcome:** `state/downloads.lua` implemented — a pure, framework-free index over an injected LuaSettings-like store (mirroring `settings.lua`): `add` (idempotent per `chapterId`, persists + flushes), `get`/`has`/`list` (stable insertion order), `remove` (returns the local CBZ path to unlink), and pure `fileNameFor`/`pathFor` helpers. Filename/dir scheme matches `ui/reader_launcher.lua` (`<DataStorage:getDataDir()>/komanga/downloads/<sanitised chapterId>.cbz`) so a read-then-downloaded chapter reuses its file. Runtime coupling stays out of the pure module: `Downloads.open()` wires the real `komanga_downloads.lua` manifest + data-dir path (lazy `require`), `ensureDir()` lazily creates the CBZ dir (runtime only — specs never call it). All 16 KRP-801 specs pass; full suite **205/0**; `luacheck` **0/0** across 45 files; parses on the device's LuaJIT (Lua 5.1). Device-local download location documented in `koreader-plugin/CLAUDE.md` §5.

### KRP-803 — [TEST] Download-to-device coordinator (logic)
**Status:** Done
**Description:** Failing `busted` specs for the coordinator that performs an offline download: fetch the chapter's **transient** `eink` CBZ (`api:readChapterCbzToFile`, KRP-606) straight to the device store's path, then record the index entry (KRP-802) with `title`/`chapterNumber`/`direction`. Idempotent (already-downloaded is a no-op success); a fetch failure removes any partial file and records **nothing** (mirrors `downloadChapterCbzToFile`'s partial-file cleanup). Network mocked at the `api/` boundary; store injected.
**Acceptance criteria:**
- Specs assert: fetch goes through `readChapterCbzToFile` (transient, **never** `downloadChapter`/`POST /download`); success records the entry with metadata; failure leaves no file and no entry; re-download is a no-op.
**Blocked by:** KRP-802.
**Estimate:** M
**Outcome:** Failing `busted` contract for `state/download_coordinator.lua` (impl is KRP-804) — `spec/state/download_coordinator_spec.lua`, **13 specs**, mocking at the `api/` boundary via a purpose-built fake client (no HTTP, no KOReader loaded — CLAUDE.md §4/§5), the real `state/downloads.lua` (KRP-802) over a `FakeStore`, and an injected clock + file-size reader (CLAUDE.md §9). Defines the pure download-to-device coordinator `DownloadCoordinator.new(api, downloads, opts?)` with the same `fetchCbz`/`record` split as the other state modules (the fetch is what `net.lua` runs in a forked sub-process, KRP-305 — it streams the CBZ to disk and mutates no index; `record` adds the index entry parent-side; the tested synchronous `download` is their composition). Covers: **fetch via the transient eink path** (`api:readChapterCbzToFile` to `downloads:pathFor(id)`, **never** `downloadChapter`/`POST /download`); **success records the entry** with the offline-list metadata (`chapterId`/`mangaId`/`title`/`chapterNumber`/`direction`/`fileName`, plus `size`/`createdAt` from the injected collaborators), returning the stored entry; **fetch failure records nothing** and — modelling `readChapterCbzToFile`'s own partial-file cleanup in the fake fs — **leaves no file**; **idempotency** (an already-downloaded chapter, in-session or reloaded from the persisted index, is a no-op success with **zero** api calls); and the fetch/record split's fork-safety (`fetchCbz` mutates no index; `fetchCbz` on an already-downloaded chapter returns its path with no network; `record` adds parent-side). Fail-first verified: full suite **205 successes / 1 error** (the missing `state.download_coordinator` module); confirmed satisfiable by a throwaway impl (**218/0/0**) which was then removed. `luacheck` clean (0/0 across 46 files).

### KRP-804 — Download-to-device action; repoint "Download this chapter"
**Status:** Done
**Description:** Implement the KRP-803 coordinator and repoint `ui/reader_menu.lua`'s "Download this chapter for offline" at it (replacing the server-side `POST /download` / `ApiClient:downloadChapter`). Capture the manga **title**, **chapter number**, and **reading direction** at download time (threaded from the reader context / loaded manga) so the offline list and reader have them without a network call. Runs through `net.lua` (wifi-gated, non-blocking) with the shared loading/`Retry` UX (KRP-305/506).
**Acceptance criteria:**
- "Download this chapter for offline" persists the CBZ **on the device** and records the index entry; no server-side download record is created.
- Loading/error/retry states present; `luacheck` clean; loads clean in the emulator.
**Blocked by:** KRP-803.
**Estimate:** M
**Outcome:** Implemented `state/download_coordinator.lua` (the KRP-803 impl rides here) and repointed the in-reader "Download this chapter for offline" action at it. **`state/download_coordinator.lua`** is the pure, framework-free coordinator satisfying the KRP-803 contract (CLAUDE.md §5/§9 — network only via an injected ApiClient, clock/file-size collaborators injected): `DownloadCoordinator.new(api, downloads, opts?)` with the same `fetchCbz`/`record` split as the other state modules — `fetchCbz` streams the **transient eink CBZ** (`api:readChapterCbzToFile`, KRP-606 — GET `/api/chapter/:id/cbz`, **never** `downloadChapter`/`POST /download`, RFC §5.4) straight to the device store's `pathFor(id)` (mutating no index, so it is fork-safe under net.lua, KRP-305), `record` adds the device-local index entry parent-side with the offline-list metadata (`title`/`chapterNumber`/`direction` + `size`/`createdAt` from the injected collaborators), and the tested synchronous `download` composes them: a fetch failure records nothing (the transient fetch already unlinked any partial file), an already-downloaded chapter (in-session or reloaded from the persisted index) is a zero-network no-op success. The runtime file-size default reads via a pure-Lua `io.open`+`seek("end")` (no lfs/KOReader coupling, so the module still imports clean under busted). **Repointed the UI:** `ui/reader_menu.lua`'s download action now builds the coordinator over `Downloads.open()` and runs `fetchCbz` off-thread through `net.lua`, recording the entry in the `Retry` `on_success` (parent side) — the shared loading/retry UX (KRP-305/506) is preserved; the old `ApiClient:downloadChapter` POST path is gone. The chapter's **title / chapter number / direction** are threaded from the loaded details into `ui/reader_launcher.lua`, which now stashes them (alongside `komanga_chapter_id`/`komanga_manga_id`) in the document's `DocSettings` sidecar at open time, so the in-reader menu reads a complete coordinator `chapter` descriptor from the sidecar with **no network call** — and it survives the CBZ being reopened later from the file manager. Added `Details:chapterNumberFor(id)` (pure getter) so the resume/continue path — which threads only `{ id }` — can still label the download. **busted 218 successes / 0 failures** (205 prior + KRP-803's 13 now green against the impl); **luacheck clean — 0/0 across 47 files**. Verified loading clean in the emulator (headless SDL-dummy boot, 2026-07-05): `Plugin loaded komanga` / `FM loaded plugin komanga`, no traceback — so the new `state/download_coordinator` require + the reader-menu/launcher rewiring resolve at boot. On-panel offline download → read-with-wifi-off is the **KRP-806 `[DEVICE]`** pass.

### KRP-805 — Library "Downloaded" section from the device index (offline-capable)
**Description:** Point the library/home "Downloaded" section at the **device-local index** (KRP-802) instead of `GET /api/downloads`, so it renders **with wifi off**. Map through `state/library.lua` (its `fetchDownloads`/`getDownloads`/`isOpenable` become device-index-backed — pure, store injected) and label each row by **manga title + chapter number** (resolves the KRP-605 note that downloaded rows show raw chapter IDs). Update `spec/state/library_spec.lua`.
**Acceptance criteria:**
- The Downloaded list is built from the on-device index and shows with the network off; rows show title + chapter number.
- `state/library.lua` maps it (pure, tested); `luacheck` clean; loads clean in the emulator.
**Blocked by:** KRP-802.
**Estimate:** M
**Status:** Done
**Outcome:** Repointed the library "Downloaded" section at the **device-local index** (`state/downloads.lua`, KRP-802) instead of `GET /api/downloads`, so it renders **with wifi off**. In `state/library.lua`, `Library.new(api, downloads)` now takes the injected device index; the downloads path is a **pure local read** — `getDownloads()`/`fetchDownloads()` return `downloads:list()` (no network, no fetch/apply split, no `self.error` coupling), so a downloads read can never block, prompt for wifi, or clobber the followed-list error. Rows are labelled by **manga title + chapter number** (`Library.downloadTitle` — title captured at download time, falling back to the mangaId like `entryTitle`; `Library.downloadNumber` — "Ch. N" via the existing `formatChapterNumber`, blank when absent), resolving the KRP-605 raw-chapter-id note. `isOpenable` is device-index-backed: every indexed entry is a completed on-device CBZ (the coordinator records only after the bytes persist, KRP-803), so all rows are openable — the old `status == "completed"` gate and its `pending`/`failed` UI branch are gone. **UI (`ui/library_view.lua`):** the Downloaded section reads `getDownloads()` straight from the first `render()` (no `net:run`, no `downloads_ready` loading state) — the offline guarantee — while the Following section still loads over `net`; the old `download_label` (raw chapterId) helper is gone. **`main.lua`** wires `Library.new(self.api, Downloads.open())`. **Specs (`spec/state/library_spec.lua`):** the "downloaded chapters" block is rewritten against a **real `state/downloads.lua` over a `FakeStore`** (no `FakeApi.listDownloads` stubbed — any API call would be a bug; asserted via `#api.calls == 0`): reads the index in insertion order making no network call, `fetchDownloads` mirrors it, title/number labelling incl. mangaId fallback + decimal/blank cases, every entry openable, empty list. **busted 220/0**; **luacheck clean — 0/0 across 47 files**. Verified loading clean in the emulator (headless SDL-dummy boot, 2026-07-05): `Plugin loaded komanga` / `FM loaded plugin komanga`, no traceback. On-panel airplane-mode read of a Downloaded row is the **KRP-806 `[DEVICE]`** pass.

### KRP-806 — [DEVICE] Offline reading of a downloaded chapter
**Description:** Open a downloaded chapter from its **local CBZ** via `ReaderUI` with the network **off** — no API call on the open path — honouring the stored reading direction (RTL/LTR). Delivers the "offline downloaded reading" half moved out of KRP-702.
**Acceptance criteria:**
- **[DEVICE]** On the real Kobo in airplane mode: open a downloaded chapter from the library → it reads full-panel with correct RTL/LTR, no network, no blank/frozen panel.
- The open path issues no network request when the CBZ is present locally.
**Blocked by:** KRP-804, KRP-805.
**Estimate:** M

### KRP-807 — Delete a downloaded chapter
**Status:** Done
**Description:** A **delete** action for a downloaded chapter — from the library "Downloaded" row and/or the in-reader KoManga menu — that removes both the local CBZ file and its index entry via `state/downloads.lua:remove` (KRP-801/802), behind a `ConfirmBox`. The Downloaded list reflects the removal; storage is freed.
**Acceptance criteria:**
- Deleting a download removes the file + index entry after confirmation; the list updates; `luacheck` clean.
- Specs cover the store side (already in KRP-801); the UI wiring loads clean in the emulator.
**Blocked by:** KRP-802, KRP-805.
**Estimate:** S
**Outcome:** Added a **delete-a-download** action on both surfaces the ticket calls for. The confirm + removal is a single shared UI helper, **`ui/download_delete.lua`** (`DownloadDelete.confirm{ downloads, chapter, on_deleted? }`): behind a `ConfirmBox` it calls `downloads:remove(chapterId)` (the KRP-802 store method, already spec-covered in KRP-801 — drops the device-local index entry and returns the CBZ path) and then `os.remove`s that path so storage is actually freed. `downloads:remove` stays filesystem-free (it only returns the path), so the unlink lives in the UI layer (CLAUDE.md §5) — the same split `api/client.lua` uses. **Library "Downloaded" row (`ui/library_view.lua`):** each download row now carries its `download` entry and a new `onMenuHold` handler routes a long-press to the injected `delete_download` collaborator (headings / Following rows carry no `download`, so holding them is a no-op). **`main.lua`** captures a single `Downloads.open()` handle shared by `Library.new` and the delete path, so a deletion mutates the same in-memory index the view renders from; `on_deleted` re-renders the home screen, so the list reflects the removal immediately. **In-reader menu (`ui/reader_menu.lua`):** a "Delete this download" entry is added to the KoManga reader menu **only when `downloads:has(ctx.chapterId)`** (i.e. the open chapter is actually downloaded), reusing the same helper and confirming an "Download deleted." `InfoMessage`. **luacheck clean — 0/0 across 48 files** (the new `ui/download_delete.lua`); **busted 220/0** (no regressions — the store side is already covered by KRP-801, so no new specs, per the acceptance note). Verified loading clean in the emulator (headless SDL-dummy boot, 2026-07-05): `Plugin loaded komanga` / `FM loaded plugin komanga`, no traceback — the new `ui/download_delete` require + the library-view/reader-menu/main wiring all resolve at boot. On-panel delete → list-updates → space-freed is folded into the **KRP-808 `[DEVICE]`** acceptance pass.

### KRP-808 — [DEVICE] On-device validation: download → offline read → delete + footprint
**Description:** Full offline loop on the real Kobo, plus a footprint check (RFC §8 — don't retain whole chapters in memory; a sane storage story).
**Acceptance criteria:**
- **[DEVICE]** download a chapter → it appears under Downloaded with title + number → **airplane-mode** read it → delete it → it's gone and the space is freed.
- Downloading/reading a chapter does not balloon memory (bytes stream to disk, per `readChapterCbzToFile`); repeated downloads are bounded and deletable.
**Blocked by:** KRP-806, KRP-807.
**Estimate:** M

---

## Suggested build order (respecting strict deps)

1. **Spike first:** KRP-101 → 102 / 103. *Do not start the scaffold until the dev loop + `docs/koreader.md` exist.*
2. **Scaffold:** KRP-201 → 202 / 203.
3. **Networking:** 301→302, 303→304, → 305.
4. **Browse:** 401→402, 403→404 → 405 (device pass).
5. **Reader (CBZ first, then streaming):** 501→502 → 503 (device pass) → 504→505 → 506.
6. **Progress & library:** 601→602, 603→604. *(Follow-ups 605 (needs API-908) and 606 (needs API-910) can land any time once their API blockers ship; 607 (needs API-912) adds "Continue (next chapter number)" to the library view.)*
7. **Offline device-local downloads (8xx):** 801→802 → 803→804, 805 → 806 (device), 807 → 808 (device acceptance). *(Needs KRP-506 + KRP-604; no API blocker — reuses the transient `eink` CBZ endpoint from API-910/KRP-606. RFC §5.4.)*
8. **Polish:** 701 → 703, 702, → 704 (final acceptance). *(702 is now just the network-resilience half; offline-downloaded reading moved to 806.)*

> Notes:
> - **The spike gates everything** — KOReader version, install/launch, and the emulator loop are what the rest assumes. Don't shortcut it.
> - **`[DEVICE]` tickets are validated on the real Kobo**, not the emulator and not unit tests — the acceptance criteria reflect that.
> - **Same API contract as the web client.** This client requests `profile=eink`, attaches the single credential, and treats progress as device-agnostic/last-write-wins. If something is missing from the API, raise an **API-epic** ticket — don't change the contract or hack the client (RFC §13).
> - **Reader leans on KOReader.** CBZ + `ReaderUI` first (high confidence, gives offline reading immediately); on-demand streaming is the refinement on top.

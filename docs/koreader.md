# KOReader Plugin Spike Report

> Source of truth for the **KOReader runtime on the target Kobo** and the plugin dev loop. Produced by the KOReader-Plugin spike (KRP-101/102/103), sibling to `docs/device.md`. Plugin tickets read from this file. It shares the same `eink` profile contract as `device.md` — both clients render the API's `eink` output. If a convention in `koreader-plugin/CLAUDE.md` conflicts with what is recorded here, **this report wins**.

---

## KRP-101 — KOReader on the target Kobo

**Status:** **Done** — verified on the real Kobo Clara BW (2026-06-28).

| Field | Value |
|---|---|
| Device | **Kobo Clara BW** (2024) — see `docs/device.md` §KWC-101 |
| Panel | 1072 × 1448, 6" E Ink Carta 1300, 16-level greyscale, 300 ppi |
| Nickel firmware | 4.45.23697 (from `docs/device.md`) |
| KOReader version | **v2026.03** (from `.adds/koreader/git-rev`; `Help → About`) |
| LuaJIT version | LuaJIT 2.1 (shipped in the KOReader Kobo build) |
| Plugin install dir | `.adds/koreader/plugins/` (on the Kobo's USB storage root → `/mnt/onboard/.adds/koreader/plugins/`) |
| Launch alongside Nickel | **KFMon v1.4.6** (one-click launcher; `koreader.png` tile in the home library). `KoboRoot.tgz` staged in `.kobo/`, auto-installed by Nickel on USB disconnect. |
| Stub plugin loads | ✅ **KoManga** entry in KOReader main menu → tapping shows the "KoManga plugin stub loaded (KRP-101)." `InfoMessage` overlay |
| Full panel (no Nickel chrome) | ✅ KOReader draws the full 1072×1448 panel, no Nickel URL bar / chrome |

### Why these facts matter
- **Version + LuaJIT** pin the Lua dialect and KOReader widget APIs the plugin targets. Firmware/KOReader updates can shift APIs (CLAUDE.md §12) — record the exact version this epic is built against.
- **Install dir** is where the deploy step (KRP-203) copies `komanga.koplugin/`.
- **Launch method** is what KRP-703 (install & launch UX) builds on.
- **Full-panel confirmation** is the reason this epic exists (CLAUDE.md §1): KOReader escapes Nickel's 732×762 viewport and chrome.

---

## On-device runbook (KRP-101)

Run these on the real Kobo Clara BW, then fill the ⏳ fields above and report the values back.

### 1. Install KOReader
1. Connect the Kobo to the Mac by USB; it mounts as **`KOBOeReader`**.
2. Download the latest stable Kobo build from <https://github.com/koreader/koreader/releases> — the asset named `koreader-kobo-*-vYYYY.MM.zip`.
3. Extract it to the **root** of `KOBOeReader` so you get `KOBOeReader/.adds/koreader/`.
4. Install a launcher so KOReader can be opened from Nickel:
   - **KFMon** (recommended, one-click): download `KFMon-*.zip` from <https://github.com/NiLuJe/kfmon/releases>, extract to the root of `KOBOeReader`. KOReader then appears as a tile/book on the home screen.
   - _or_ **NickelMenu**: <https://github.com/pgaskin/NickelMenu> — adds a launch entry to Nickel's menu.
5. Eject and unplug. Let Nickel re-import. Open the KOReader launcher (the KFMon tile or NickelMenu entry).

### 2. Read the versions
- **KOReader version:** top menu → tools/gear → **Help → About** (shows e.g. `v2024.04`). Record verbatim.
- **LuaJIT version:** the Kobo build ships **LuaJIT 2.1**; record as such (no need to dig unless About surfaces it).

### 3. Install the stub plugin
1. Reconnect USB.
2. Copy the whole `koreader-plugin/komanga.koplugin/` folder into `KOBOeReader/.adds/koreader/plugins/` so you get `…/plugins/komanga.koplugin/main.lua`.
3. Eject/unplug. In KOReader, fully **restart** (top menu → exit/restart) so plugins reload.

### 4. Verify acceptance
- Open the main menu — a **KoManga** entry should appear; tapping it shows the “KoManga plugin stub loaded (KRP-101).” popup. → fills *Stub plugin loads* ✅
- Confirm KOReader fills the **whole panel** with no Nickel URL bar / chrome. → fills *Full panel* ✅

### Report back
Paste the KOReader version string, the launcher you used, and ✅/✗ for the stub-loads and full-panel checks. I'll finalize the table above and mark KRP-101 Done.

### Gotcha: KOReader's icon SVGs imported into the Nickel library
On FW ≥ 4.17, Nickel indexes image content found in **hidden** directories, so it imported ~226 of KOReader's UI icons (`.adds/koreader/resources/icons/**/*.svg`, names like `appbar.crop`, `align.justify`) into the Kobo content database — they appear as junk "books" in **My Books**. Harmless (KOReader needs them to render its menus), but cluttering.

- **Do not delete the files** — KOReader needs them.
- **Fix (applied):** the official KOReader/KFMon fix — add to `.kobo/Kobo/Kobo eReader.conf`:
  ```
  [FeatureSettings]
  ExcludeSyncFolders=(\\.(?!kobo|adobe).+|([^.][^/]*/)+\\..+)
  ```
  This stops Nickel scanning custom hidden dirs (excludes everything hidden except `.kobo`/`.adobe`). Set on-device 2026-06-28; original backed up to `Kobo eReader.conf.komanga-backup`.
  Ref: <https://github.com/koreader/koreader/wiki/Installation-on-Kobo-devices#important-notes>
- **Note:** the exclusion prevents *future* imports; the ~226 rows already in `KoboReader.sqlite` may persist until a re-scan clears them. If the clutter remains after reconnecting, do a one-off targeted DB cleanup (delete `content` rows where `ContentID LIKE '%.adds/koreader/resources/%'`, DB backed up first, keeping the `koreader.png`/`kfmon.png` launch tiles).

---

## KRP-102 — Emulator dev environment

**Status:** **Done** — verified on the dev Mac (Apple Silicon, arm64; macOS 26 / Darwin 25.0.0), 2026-06-28.

KOReader ships **no prebuilt macOS binary** (releases cover Kobo/Kindle/Android/Linux/AppImage only), so the desktop emulator is **built from source** with `kodev`. To avoid polluting the Mac with a global toolchain, everything — the build tools *and* the KOReader source/build — lives in **one deletable folder**, `koreader-plugin/.emulator/` (git-ignored). Removing that folder fully removes the emulator; nothing is installed globally and no `sudo` is used.

### What's in `koreader-plugin/.emulator/`
| Path | What |
|---|---|
| `bin/micromamba` | standalone [micromamba](https://mamba.readthedocs.io) binary (the only thing downloaded loose) |
| `env/` | conda-forge build toolchain (see below), self-contained prefix |
| `getopt-env/` | separate prefix for `util-linux` (provides GNU `getopt` + `flock`); kept apart because it conflicts with the toolchain's Python. Its `getopt`/`flock` are symlinked into `env/bin`. |
| `src/` | KOReader source clone, pinned to **`v2026.03`** (matches the on-device version, KRP-101) |
| `src/koreader-emulator-arm64-apple-darwin25.0.0-debug/koreader/` | the built emulator (run target) |
| `buildenv.sh` | `source` it to put the contained toolchain on `PATH` for any build command |
| `*.log` | last fetch/build/run logs |

### Toolchain (conda-forge, in `env/`)
`cmake (<3.31)` · `make` · `autoconf` · `automake` · `libtool` · `nasm` · `pkg-config` · `gettext` · `wget` · `meson` · `ninja` · `ragel` · `coreutils` · `perl` · `bash (5.x)` · plus `getopt`/`flock` from `util-linux`. SDL is the one host dependency taken from the system (`/opt/homebrew/lib/libSDL3.dylib`, found at runtime).

### macOS build gotchas (all handled in `env/`, recorded so a rebuild is reproducible)
- **`cmake` must be 3.x.** cmake 4.x drops support for `cmake_minimum_required(VERSION < 3.5)`, which several of KOReader's pinned third-party libs still declare → pinned to `cmake 3.30`.
- **`kodev` needs `bash` ≥ 4.0** — macOS ships 3.2; the env provides bash 5 (`kodev` uses `/usr/bin/env bash`, so env-on-PATH wins).
- **`kodev` needs GNU enhanced `getopt`** (macOS has BSD getopt) → symlinked from the `util-linux` prefix.
- **Third-party download steps call `flock`** (not on macOS) → symlinked from `util-linux`.
- **Makefiles call Homebrew-style `g`-prefixed coreutils** (`gln -snfr`, etc.; macOS `ln` lacks `-r`) → `g`-prefixed symlinks for the coreutils set created in `env/bin`.
- The C/C++ compiler is the **system Apple clang** (Xcode CLT); only the build *tools* come from the env.

### Reproduce the build (one-time)
```sh
EMU="$(git rev-parse --show-toplevel)/koreader-plugin/.emulator"
source "$EMU/buildenv.sh"          # puts the contained toolchain on PATH
cd "$EMU/src"
./kodev fetch-thirdparty           # init submodules + fetch third-party sources
./kodev build                      # builds the host (macOS) SDL emulator  (~minutes)
```

### Run command (the dev loop)
```sh
source "$EMU/buildenv.sh"
cd "$EMU/src"
./kodev run                        # default 540×720 window
# device-shaped window for layout work:
./kodev run -b -W 1072 -H 1448 -D 300   # -b = use existing build (skip rebuild)
# or a built-in preset:  ./kodev run -b --simulate=kobo-clara
```
`./kodev run` rebuilds if needed then launches the SDL window. Quit from KOReader (top menu → exit) or close the window.

### Loading the in-development plugin
The emulator reads plugins from `…/koreader-emulator-…/koreader/plugins/`. For the dev loop the plugin is **symlinked** in so source edits are picked up on the next KOReader restart with no copy step:
```sh
ln -sfn "$(git rev-parse --show-toplevel)/koreader-plugin/komanga.koplugin" \
        "$EMU/src/koreader-emulator-arm64-apple-darwin25.0.0-debug/koreader/plugins/komanga.koplugin"
```
*(A one-command deploy/reload wrapper for both emulator and device is KRP-203; this is just the manual mechanism.)*

### Acceptance — verified
The stub plugin from KRP-101 loads in the emulator. From the boot log (`.emulator/run.log`):
```
INFO  Looking for plugins in directory: plugins
DEBUG Plugin loaded komanga
DEBUG RD loaded plugin komanga at plugins/komanga.koplugin
```
The **KoManga** main-menu entry appears and its `InfoMessage` stub shows — no Lua/load errors.

### What the emulator can and cannot validate
**Can (fast off-device iteration):**
- Plugin loads, menu wiring, widget layout and navigation flow.
- Pure logic (API client, state, page mapping) — though that's better covered by `busted` (KRP-103).
- Catching Lua errors / stack traces quickly.

**Cannot (real Kobo only — these are `[DEVICE]` tickets):**
- **E-ink refresh behaviour and "feel"** — ghosting, flash vs partial refresh, `UIManager:setDirty` mode quality. The emulator paints to an LCD; it does not reproduce the panel's waveforms.
- **Exact panel pixels.** On a Retina Mac the SDL backing buffer is **2× the logical size** (default 540×720 → 1080×1440 framebuffer), and a logical height of 1448 exceeds a laptop screen so the window is **clamped** — the emulator cannot match the Kobo's true 1072×1448 at 300 ppi. Use it for relative layout, not pixel-accurate legibility.
- Touch latency, real Wi-Fi/`NetworkMgr` gating, and overall reading responsiveness.

> **Rule:** the emulator is for fast iteration only. `[DEVICE]`-tagged tickets are **never** closed from the emulator alone (CLAUDE.md §4, §12).

## KRP-103 — busted test harness

Pure-Lua logic (`api/`, `state/`, page mapping, progress debounce) is unit-tested
with **busted**; visual/refresh behaviour is not (that's `[DEVICE]` work — CLAUDE.md §4).

### Test runtime — reuse the emulator's busted
No separate test toolchain is installed. The emulator build (KRP-102) already
produced busted plus its dependency rocks (penlight, luassert, say…) under
`koreader-plugin/.emulator/src/base/build/<triple>/spec/rocks`, running on the
**same LuaJIT the plugin ships on**. The harness reuses that, so there is nothing
extra to install and no global state — consistent with the emulator's
self-contained, deletable footprint.

### Layout (inside `komanga.koplugin/`)
```
.busted              # busted config: ROOT=spec, pattern=_spec, lpath=./?.lua (plugin root)
.luacheckrc          # std=luajit; spec/ adds busted globals
spec/
  run.sh             # the test runner (globs the emulator build, wires LUA_PATH, runs busted)
  smoke_spec.lua     # trivial logic spec — proves the harness runs
  support/
    fake_api.lua     # the api-boundary mock (inject into state/ui modules)
    fake_api_spec.lua# demonstrates the mocking pattern
```
Specs are matched by the `_spec` suffix, so `support/fake_api.lua` is a helper,
not a spec.

### Run command
```sh
koreader-plugin/komanga.koplugin/spec/run.sh            # run all specs
koreader-plugin/komanga.koplugin/spec/run.sh --verbose  # extra args pass through to busted
```
Runs from any cwd. If the emulator isn't built it falls back to a `busted` on
`PATH`. Expected output: `N successes / 0 failures / 0 errors`.

### Mocking the network at the `api/` boundary
The plugin's only network boundary is `api/` (CLAUDE.md §5): `state/` and `ui/`
modules receive an `ApiClient` and never call `socket.http` themselves. Logic
specs therefore **mock at that boundary by injecting a fake client**, not by
stubbing the HTTP layer. `spec/support/fake_api.lua` builds one: configure
canned responses (values or functions) per method, inject it into the module
under test, and assert on `api.calls`:

```lua
local FakeApi = require("spec.support.fake_api")
local api = FakeApi.new{ search = { data = { { title = "Berserk" } } } }
local results = SomeState.new(api):search("berserk")  -- inject the fake
assert.are.equal("search", api.calls[1].method)       -- inspect recorded calls
```

The **only** place that drops below this boundary to mock raw HTTP is the
API-client's own spec (KRP-301), which is what tests transport/auth/envelope
handling.

## KRP-202 — module layout, config & settings

The plugin's internal structure (CLAUDE.md §5), established here so the feature
tickets drop modules into a known shape:
```
komanga.koplugin/
  main.lua           # entry: WidgetContainer:extend, menu entry, opens settings
  _meta.lua          # plugin metadata
  config.lua         # API base URL + tuning knobs (defaults)
  settings.lua       # LuaSettings-backed persistence (credential, knob overrides)
  api/               # the REST client — the ONLY place HTTP lives (KRP-301/302)
  state/             # framework-free pure logic; busted-testable (KRP-4xx/5xx)
  ui/                # one module per screen, on KOReader widgets (KRP-402+)
  spec/              # busted specs (logic only)
```
`api/`, `state/`, `ui/` are empty namespaces for now (a `.gitkeep` noting each
dir's role keeps them in git); `net.lua` (the Trapper + NetworkMgr wrapper) lands
with KRP-305. Sibling modules load by bare name — KOReader's plugin loader
prepends the plugin root to `package.path`, so `require("config")` and
`require("settings")` resolve to the files above, on-device and in the emulator.

### config & settings split
- **`config.lua`** returns a plain table of defaults: `api_base_url` (the
  Cloudflare Tunnel origin — absolute, unlike the same-origin web client),
  `prefetch_window` (KRP-504), `progress_debounce_seconds` (KRP-601).
- **`settings.lua`** is pure logic over an injected LuaSettings-like store
  (`Settings.new(store)`), so busted tests it with a fake store and no KOReader.
  `Settings.open()` is the runtime factory that opens the plugin's own
  `settings/komanga.lua` via `DataStorage` + `LuaSettings`. Getters fall back to
  the `config` defaults; setters `flush()` so values (notably the credential)
  survive a KOReader restart (KRP-303). Verified loading clean in the emulator
  (`FM loaded plugin komanga`, no traceback).

## KRP-203 — deploy / reload dev scripts

One script turns "edit Lua → see it run" into a single command instead of manual
file shuffling: `koreader-plugin/scripts/deploy.sh` (location-independent, sibling
to `komanga.koplugin/` and `.emulator/` so it isn't shipped as part of the plugin).

KOReader has **no hot-reload** — it reads `plugins/` once at start, so "reload"
always means a KOReader restart. The script handles placing the files; the `run`
target restarts the emulator for you.

| Command | What it does |
|---|---|
| `scripts/deploy.sh emulator` | Symlinks `komanga.koplugin` into the emulator's `…/koreader/plugins/` (globs the platform-triple build, KRP-102). A **symlink** is deliberate — source edits are picked up on the next restart with no copy step. Then restart KOReader to reload. |
| `scripts/deploy.sh device` | Copies the plugin onto the Kobo over USB to `.adds/koreader/plugins/komanga.koplugin/` (install dir per KRP-101). Uses `rsync -a --delete`, excluding dev-only files (`spec/`, `.busted`, `.luacheckrc`, `*.log`) so the device install stays clean. The Kobo is exFAT and can't hold macOS extended attributes, so it spills them into AppleDouble `._*` sidecars on write — `COPYFILE_DISABLE=1` suppresses that and a `dot_clean -m` pass sweeps any that slip through. Errors clearly if the Kobo isn't mounted (`KOBO_MOUNT` env overrides the default `/Volumes/KOBOeReader`). Eject + restart KOReader to reload. |
| `scripts/deploy.sh run [args...]` | The one-command dev loop: deploy to the emulator, then `source buildenv.sh` + `./kodev run` (extra args, e.g. `-b -W 1072 -H 1448 -D 300`, pass through to `kodev run`). |

**Verified (2026-06-28, emulator):** `scripts/deploy.sh run -b` links the plugin
and boots the emulator in one command — boot log shows `Plugin loaded komanga` /
`FM loaded plugin komanga at plugins/komanga.koplugin`, no Lua errors. A change to
`main.lua` is reflected immediately through the symlink (deployed path resolves to
source).

**Device deploy verified (2026-06-28):** `scripts/deploy.sh device` copied the plugin
to the Kobo over USB; the install dir contains exactly the runtime files
(`main.lua`, `_meta.lua`, `config.lua`, `settings.lua`, `api/`, `state/`, `ui/`) with
dev-only files and AppleDouble `._*` sidecars excluded (zero `._*` left on the
volume). On-panel confirmation (menu entry loads after eject + KOReader restart)
is the user's `[DEVICE]` check.

### Lint pass (luacheck)
`luacheck` is installed into the emulator build's rocks tree — no global install,
same self-contained footprint as busted (KRP-102/103):
```sh
luarocks --tree=<emulator build>/spec/rocks install luacheck
```
Run it via the runner (globs the build dir, falls back to a `luacheck` on `PATH`):
```sh
koreader-plugin/komanga.koplugin/spec/lint.sh            # lint the whole plugin
koreader-plugin/komanga.koplugin/spec/lint.sh main.lua   # ...or specific files
```
`.luacheckrc` mirrors KOReader's own (`std=luajit`, `unused_args=false`,
`self=false`) so widget-callback idioms don't read as warnings; `spec/` adds
busted globals. Expected output: `0 warnings / 0 errors`.

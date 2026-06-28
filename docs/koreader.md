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

_TBD (KRP-102). Will record the SDL emulator run command and what it can/cannot validate (logic/layout yes; e-ink refresh/feel no — device only)._

## KRP-103 — busted test harness

_TBD (KRP-103). Will record the spec run command and the network-mocking pattern at the `api/` boundary._

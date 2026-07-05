# CLAUDE.md — KoManga KOReader Plugin

> Project context and conventions for the **KOReader Plugin epic**. Read this before working any `KRP-NNN` ticket. The authoritative *what* lives in `RFC.md` (root) and `TASKS.md` (this folder); this file is the *how*.

---

## 1. What this is

A KOReader plugin (`komanga.koplugin`) that runs **inside KOReader on the Kobo** and consumes the KoManga API. It is the **second client** of that API (the web client is the first), and it exists for one reason the web client can't solve: the Kobo's Nickel browser only exposes a **732×762** viewport on the 1072×1448 panel and wraps it in chrome the page cannot hide. KOReader draws to the **full panel**, has no browser chrome, and brings a tuned e-ink refresh engine and a native CBZ reader with it.

It does almost no heavy work — it browses, it reads, it syncs progress. All scraping, image processing, CBZ building, and storage happen server-side, exactly as for the web client.

**Golden rule (inherited):** the emulator lies the way the monitor lies; the e-ink panel is the truth. Visual/refresh work is validated on the real device.

---

## 2. Tech stack (do not substitute without updating this file)

| Concern | Choice |
|---|---|
| Language | **Lua** (LuaJIT, as shipped by KOReader — confirm version in KRP-101) |
| Framework | **KOReader's widget framework.** No external UI libs. |
| Build | **None.** Lua ships as-is; "deploy" = copy the `.koplugin` to `koreader/plugins/` and reload (KRP-203). |
| HTTP | `socket.http` / `ssl.https` + `ltn12`; JSON via `rapidjson` |
| Async / UX | `Trapper` (coroutine-wrapped calls + loading/cancel dialog) so the UI never blocks; `NetworkMgr` to gate on wifi |
| UI widgets | `Menu`, `InputDialog`, `InfoMessage`, `ConfirmBox`, `ButtonDialog`, shown via `UIManager:show` |
| Reader | `ReaderUI:showReader(path)` over a server-built **`eink` CBZ** (KOReader reads CBZ natively) |
| Settings | `LuaSettings` (credential, knobs) |
| E-ink refresh | KOReader's `UIManager:setDirty` (`full` / `flashui` / `partial` / …) — we lean on it, we don't re-derive it |
| Lint | `luacheck` |
| Tests | `busted` (logic only — see §4) |
| Dev loop | KOReader desktop **emulator** (off-device iteration) + the real Kobo |

**Plugin shape:** a directory `komanga.koplugin/` containing `main.lua` + `_meta.lua`. `main.lua` does `Komanga = WidgetContainer:extend{ name = "komanga", is_doc_only = false }`, registers a menu entry via `addToMainMenu`, and shows widgets through `UIManager:show`.

---

## 3. The spike gates everything (RFC §11)

`KRP-101/102/103` produce `docs/koreader.md` (repo root, sibling to `docs/device.md`) and a working dev loop. **Do not start the scaffold or any UI ticket until they exist.** They decide:

- Exact KOReader + LuaJIT version on the target Kobo, the plugin install path, and how KOReader is launched alongside Nickel.
- The emulator run command and **what the emulator can / cannot validate** (logic & layout yes; e-ink refresh & feel no — device only).
- The busted test pattern (network mocked at the `api/` boundary).

If a convention here conflicts with what `docs/koreader.md` found on the real device, **the device report wins** — update this file.

---

## 4. Two validation modes (not pure TDD)

Same split as the web-client epic, because an e-ink panel can't be asserted in a test runner.

- **Logic tickets** (API client, auth, browse/search state, page mapping, prefetch, progress sync) — **strict TDD**: a `[TEST]` ticket writes failing `busted` specs, the impl ticket makes them pass. Mock the network at the `api/` boundary.
- **`[DEVICE]` tickets** (anything visual/rendering/refresh) — acceptance is a **verified on-device check**. The emulator is for fast iteration only; **never close a `[DEVICE]` ticket from the emulator alone.**

---

## 5. Architecture

Keep it simple and modular — structured, not a pile of scripts. Inside `komanga.koplugin/`:

```
main.lua        # entry: WidgetContainer:extend, menu registration, wires the rest
_meta.lua       # plugin metadata (name, fullname, description)
api/            # the typed-ish REST client — the ONLY place HTTP lives
state/          # pure logic: browse/search/reader/progress state; busted-testable
ui/             # one module per screen: library, search, manga-details, reader glue
net.lua         # the Trapper + NetworkMgr wrapper every view calls (KRP-305)
config.lua      # API base URL + knobs (prefetch window, debounce)
settings.lua    # LuaSettings-backed persistence (credential, prefs)
spec/           # busted specs, mirroring the modules; logic only
```

- **All network access goes through `api/` (via `net.lua`).** No UI or state module calls `socket.http` directly — this keeps transport, auth injection, wifi gating, and loading UX in one place and keeps everything else mockable.
- **State is framework-free and pure** so busted can test it without KOReader loaded.
- **UI leans on KOReader widgets.** Build screens from `Menu`/`InputDialog`/etc.; never hand-roll layout or refresh.
- **No business logic in UI modules beyond presentation** — fetching/decisions live in `state/` + `api/`.

---

## 6. API contract this client relies on (RFC §6, §7) — same as the web client

- **Page images / CBZ:** always request the **`eink`** profile (`?profile=eink`). This client never wants `raw` (that's for future colour clients).
- **Auth:** single-user credential attached to every `/api/*` request; on `401`, route back to the credential prompt.
- **Progress:** device-agnostic, server-side, last-write-wins. Push progress on page turns (**debounced**). On opening a manga, resume from the synced position.
- **Reading direction:** comes from the manga metadata (RTL/LTR); the reader honours it for page order and tap-zone mapping.
- **Streaming vs download:** primary reading uses a server-built `eink` CBZ opened in KOReader's reader; "download chapter" keeps it for offline. On-demand streaming is a refinement (KRP-504/505).
- The client only ever talks to the API's REST surface — never to Suwayomi directly.

**Do not change the API contract to suit only this client (RFC §13).** If something's missing (e.g. a way to fetch the built CBZ bytes), raise an **API-epic ticket**, don't hack the plugin.

---

## 7. KOReader / e-ink principles

- **Lean on KOReader's refresh engine.** Use `UIManager:setDirty` modes appropriately (`flashui`/`full` where a clean repaint matters, `partial`/`ui` otherwise); pass the dither hint for image-heavy repaints. Don't reimplement refresh policy — KOReader already tuned it.
- **Read via CBZ + `ReaderUI` first.** It inherits paging, zoom, fit-to-panel, RTL, and refresh — the parts that were hardest in the browser. Custom viewers are a last resort, only for true streaming.
- **Never block the UI thread.** Wrap every network call in `Trapper` + `NetworkMgr` (`net.lua`); a slow call shows a dismissable loading state, not a frozen panel.
- **Large tap targets, high contrast, generous type** — `Menu` gives most of this; tune sizes on-device (KRP-701).
- **Tolerate latency visibly:** every fetch has a clear loading and error/retry state — never leave a blank panel.

---

## 8. Performance & footprint

- The bottleneck is **network + image decode + e-ink refresh**, not Lua — KOReader does decode/refresh in its C core, so don't micro-optimise Lua; spend effort on prefetch and refresh tuning instead.
- **Bounded prefetch / progressive download** (KRP-504/505) within a configurable window so a page turn shows an already-fetched page; never prefetch unboundedly.
- Release pages/temp files that are off-screen; don't retain whole chapters in memory.

---

## 9. Coding standards

- **Comments only for complex code that isn't understandable without them.** Do NOT narrate obvious lines, restate what the code says, or add a comment above every step/file. A comment must earn its place by explaining a non-obvious *what* or *why*; otherwise leave it out. Before writing any comment, ask "is this code genuinely unreadable without it?" — if not, delete it.
- **`luacheck` clean** before a ticket is Done; small, single-purpose modules; pure functions in `state/`.
- Map the API's `{ data }` envelope to plugin-domain tables in `api/` — the rest of the app never sees the wire shape.
- Name by role (`ApiClient`, `ReaderState`, `net`), not by library.
- Only `api/`/`net.lua` touch the network. Handle errors explicitly with user-visible `InfoMessage` states; never swallow them or leave the panel blank.
- No global state for external dependencies; pass collaborators in (so busted can inject fakes).

---

## 10. Multi-client (RFC §13)

This is a **client of the shared API**, alongside the web client (and future website/mobile). That means:

- Optimise hard for KOReader/Kobo — but **keep client-specific assumptions (CBZ-reader strategy, `eink` profile, KOReader widgets) inside this epic**, not pushed into the API.
- If the API is missing something, it's an API-epic ticket, not a plugin workaround.
- Don't duplicate the web client's logic by copy-paste across epics — they're independent clients; shared truth lives in the **API**, not in shared client code.

---

## 11. Definition of Done (every KRP ticket)

- [ ] For logic tickets: paired `[TEST]` `busted` specs all pass; network mocked at the `api/` boundary.
- [ ] For `[DEVICE]` tickets: validated on the **real Kobo**, meeting the on-device acceptance criteria (emulator alone is not enough).
- [ ] `luacheck` clean.
- [ ] Network access only via `api/`/`net.lua`; every call wrapped in `Trapper` + `NetworkMgr` (non-blocking, wifi-gated).
- [ ] Page images / CBZ requested with `profile=eink`; progress pushes debounced.
- [ ] Loading/error states present for every async path.
- [ ] `docs/koreader.md` updated if the spike/tuning produced new findings.

---

## 12. Gotchas / notes

- **The spike is not optional.** KOReader version, install/launch, and the emulator loop all derive from it; shortcutting it means rework.
- **Emulator ≠ device.** The emulator validates logic and layout, never e-ink refresh/feel — `[DEVICE]` tickets need the real Kobo.
- **No build step, but you must reload.** Editing Lua does nothing until the plugin is redeployed and KOReader/emulator reloads it (KRP-203).
- **KOReader reads CBZ natively** — the single biggest leverage point. The API already builds `eink` CBZs (API epic), so the reader is mostly "acquire CBZ → `ReaderUI:showReader`", not a hand-built viewer.
- **Network calls must be wifi-gated and non-blocking.** On an e-reader wifi may be asleep; a raw `socket.http` call on the UI thread freezes the panel. Always go through `net.lua` (`Trapper` + `NetworkMgr`).
- **Firmware/KOReader updates can shift APIs.** Keep all KOReader-API coupling in `ui/` and `net.lua`; keep `state/` and `api/` pure so an upgrade breaks few modules.
- **Don't talk to Suwayomi** — only the KoManga REST surface, same as every other client.

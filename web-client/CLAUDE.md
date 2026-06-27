# CLAUDE.md — KoManga Kobo Web Client

> Project context and conventions for the **Kobo Web Client epic**. Read this before working any `KWC-NNN` ticket. The authoritative *what* lives in `RFC.md` (root) and `TASKS.md` (this folder); this file is the *how*.

---

## 1. What this is

A deliberately thin web client that runs **inside the Kobo's Nickel browser** (an old WebKit build) and consumes the KoManga API. It does almost no heavy work — it browses, it reads, it syncs progress. All scraping, image processing, and storage happen server-side.

It is also the **first** of several clients (a website and mobile app come later, as separate epics). This client must not assume it is the only consumer, but it *is* allowed to be aggressively optimised for one device: the Kobo.

**Golden rule:** the monitor lies; the e-ink panel is the truth. Visual/rendering work is validated on the real device, not in a desktop browser.

---

## 2. Tech stack (do not substitute without updating this file)

| Concern | Choice |
|---|---|
| Language | TypeScript (strict), authored modern |
| Framework | **None.** Vanilla DOM. No React/Preact/Vue. |
| Build | esbuild or Vite, targeting **ES5** (WebKit 538.1), minified, assets to `dist/`. KWC-102: pure ES5 — also **polyfill missing globals** (`Promise`, `Object.assign`, `Array.from`, etc.); transpilation alone is not enough |
| Transport | **XHR** (KWC-102: no `fetch`, no `URL`/`URLSearchParams`; build query strings by hand). `localStorage` available for auth |
| Layout | **Legacy `-webkit-box` flexbox** (KWC-102: no modern flex, no grid, no CSS custom properties). Size relative to the **732×762** viewport, not the 1072 panel |
| Serving | Static `dist/` served **same-origin by the Node API** (no CORS) |
| Tests | Vitest (for logic only — see §4) |
| Reach | Via the same Cloudflare Tunnel as the API |

**"Write modern, ship ancient":** author in clean modern TS; let the build transpile down to what the Kobo browser runs. Never hand-write old syntax, but never ship untranspiled modern syntax either.

---

## 3. The device spike gates everything (RFC §11)

`KWC-101/102/103` produce `docs/device.md` (at the repo root). **Do not start the build pipeline or any UI ticket until that report exists.** It decides:

- Exact model, panel resolution, and Nickel/WebKit version.
- Build target (ES level), supported JS APIs (fetch vs XHR), supported CSS, renderable image format(s), and the touch/event model.
- E-ink refresh behaviour: paged vs scroll, when to force a full refresh, animation policy, tap-target sizing, image draw latency.

If a convention here conflicts with what `docs/device.md` found on the real device, **the device report wins** — update this file.

---

## 4. Two validation modes (not pure TDD)

Unlike the API epic, not everything here can be unit-tested, because an e-ink panel can't be asserted against in a test runner.

- **Logic tickets** (API client, reader state, navigation, prefetch, progress sync, pagination) — **strict TDD**: a `[TEST]` ticket writes failing tests, the impl ticket makes them pass. Mock the network at the API-client boundary.
- **`[DEVICE]` tickets** (anything visual/rendering) — acceptance is a **verified on-device check**, described in the ticket's acceptance criteria. No unit test substitutes for loading it on the Kobo.

Never claim a `[DEVICE]` ticket Done from a desktop browser alone.

---

## 5. Architecture

Keep it simple and modular — but structured, not a pile of scripts.

```
src/
  api/         # typed client wrapping the KoManga REST API (the only place fetch/XHR lives)
  state/       # app state + reading state; framework-free, pure, testable
  router/      # minimal view router (hash/state based, no full reloads)
  views/       # one module per view: library, search, manga-details, reader
  render/      # DOM helpers + the central e-ink refresh policy helper
  config.ts    # client config (API base, prefetch window, etc.)
  main.ts      # entry: wire router + views, mount shell
test/          # mirrors src/ ; logic tests only
```

- **All network access goes through `src/api/`.** No view or state module calls fetch/XHR directly. This keeps the transport choice (and auth header injection) in one place and makes everything else mockable.
- **State is framework-free and pure** so it can be unit-tested without a DOM.
- **Rendering goes through `render/`**, which owns the e-ink refresh policy — views describe *what* to show; the render layer decides *how* to paint it (including any forced full refresh). Don't scatter raw DOM-thrash across views.
- **No business logic in views beyond presentation** — fetching/decisions live in state + api modules.

---

## 6. API contract this client relies on (RFC §6, §7)

- **Page images:** always request `GET /api/page/:id?profile=eink`. This client never wants `raw`. (The `raw` profile exists for the future colour clients.)
- **Auth:** single-user credential attached to every `/api/*` request; on `401`, route back to the credential prompt.
- **Progress:** device-agnostic, server-side, last-write-wins. Push progress on page turns (**debounced** — do not hammer the API on every tap). On opening a manga, resume from the synced position.
- **Reading direction:** comes from the manga metadata (RTL/LTR); the reader must honour it for page order and tap-zone mapping.
- **Streaming vs download:** default reading streams pages on demand; "download chapter" is an explicit action hitting the API's download endpoint. Downloaded chapters must be readable when offline.

The client only ever talks to the API's REST surface — never to Suwayomi directly.

---

## 7. E-ink UI principles (RFC §6; tune via the spike)

- **No animations / transitions.** They smear on e-ink.
- **Paged navigation** by tap zones, not smooth scroll, unless the spike says otherwise.
- **Large tap targets** sized per the spike's guidance.
- **Force a full refresh** where ghosting would otherwise accumulate (view changes, page turns) — centralised in `render/`.
- **High contrast, generous type.** Legibility on a reflective greyscale panel beats density.
- **Minimise repaints.** Update only what changed; avoid layout thrash.
- **Tolerate latency visibly:** every page/image load has a clear loading and error/retry state — never leave a blank panel.

---

## 8. Performance & footprint

- Keep the bundle small — old WebKit parses slowly. No heavy dependencies; justify every added library.
- **Client-side prefetch** the next page(s) within a configurable window so a tap shows an already-fetched image (complements server-side prefetch). Bound it; don't prefetch unboundedly.
- Avoid large in-memory image retention; let the browser/API caching do its job and release what's off-screen.
- First paint after launch should land on the library/home view quickly.

---

## 9. Coding standards

- **TypeScript strict mode on.** Precise types at the API boundary; map API responses to client-domain types in `src/api/`.
- **Lint + format must pass** before a ticket is Done.
- Small, single-purpose modules. Pure functions in `state/`.
- Name by role (`ApiClient`, `ReaderState`, `renderPage`), not by library.
- Only `src/api/` touches the network. Only `render/` touches the refresh policy.
- Handle errors explicitly with user-visible states; never leave the panel blank or the app in a silent failed state.

---

## 10. Multi-client future (RFC §13)

A website and mobile app are separate future epics that share the **same API**. For this epic that means:

- It is fine to optimise this client hard for the Kobo — but **don't change the API contract** to suit only the Kobo. If something's missing from the API, raise it as an API-epic ticket rather than hacking the client.
- Keep client-specific assumptions (e-ink, `eink` profile, tap zones) **inside this client**, not pushed into shared API behaviour.

---

## 11. Definition of Done (every KWC ticket)

- [ ] For logic tickets: paired `[TEST]` assertions all pass; covered at the right layer (network mocked at the `api/` boundary).
- [ ] For `[DEVICE]` tickets: validated on the **real Kobo**, meeting the on-device acceptance criteria.
- [ ] Build output runs on the Kobo browser (no untranspiled modern syntax in the bundle).
- [ ] Lint + format + type-check clean.
- [ ] Network access only via `src/api/`; refresh policy only via `render/`.
- [ ] No animations; loading/error states present for every async path.
- [ ] Page images requested with `profile=eink`; progress pushes debounced.
- [ ] `docs/device.md` updated if the spike/tuning produced new findings.

---

## 12. Gotchas / notes

- **The spike is not optional and not throwaway-able knowledge.** Build target, transport, layout, and refresh policy all derive from it. Shortcutting it means rework.
- **Desktop ≠ device.** Code that looks perfect in Chrome can ghost, mis-size, or fail to render an image format on the Kobo. Validate `[DEVICE]` tickets on hardware.
- **Same-origin serving** (KWC-202) is what avoids CORS — coordinate with the API epic's static-serving/deployment tickets; don't introduce a second origin.
- **Old WebKit surprises:** features you assume (newer CSS, some JS APIs) may be missing. When in doubt, check the spike report or test on-device before relying on them.
- **Image format:** serve/request whatever the spike confirmed the panel renders reliably (the API's `eink` profile output format must match).
- **Scroll does not reliably paint (KWC-103).** On this Nickel/WebKit build, long-page vertical scroll left content below the fold *unpainted* until a later scroll forced a repaint. **Never build long-scroll views.** Fit each view to the 732×762 viewport (or page) and advance by explicit content swaps, and **force a full refresh in `render/` on every view change and page turn** — the panel needs an explicit repaint trigger, not just for ghosting but to paint at all. (In-place high-contrast swaps near the top showed little ghosting and a short JS animation looked "smooth" on the Carta 1300 panel — but the no-animation, paged, force-refresh rules stand regardless; the paint-reliability quirk is the binding constraint.) Per-page `eink` PNG up to ~1 MB draws in ~300 ms (rated instant); weight is not the bottleneck — tunnel bandwidth is, so prefetch still matters.
- **core-js global Symbol/Map/Set polyfills crash this WebKit (KWC-201).** The first on-device load threw `TypeError: Incompatible receiver, Symbol required` at polyfill *install* time — core-js's global `Symbol` module (dragged in with `map`/`set`) trips over the Kobo's partial/broken native Symbol. **Do not blanket-import `core-js/stable/symbol` / `map` / `set` for this client.** The shipped set is Promise, Object.assign, Array.from, Array.includes (`src/polyfills.ts`), which install cleanly. If a future ticket needs Map/Set/Symbol, prefer Symbol-free code (string-keyed objects, plain arrays) or a guarded polyfill, and re-verify on-device. See `docs/device.md` §KWC-201. The build pipeline that enforces ES5 is `scripts/build.mjs`: **esbuild** (bundle) → **Babel** preset-env→ES5 → **terser** `ecma:5`; esbuild alone can't emit ES5 (its floor is ES2015).

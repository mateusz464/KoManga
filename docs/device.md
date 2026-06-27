# Device Capability Report

> Source of truth for the **target Kobo device**. Produced by the Device Capability Spike (KWC-101/102/103). Build target, transport, layout, image format, and the e-ink refresh policy all derive from this file. If a convention in `web-client/CLAUDE.md` conflicts with what is recorded here, **this report wins**.

---

## KWC-101 — Device identity & resolution

| Field | Value |
|---|---|
| Model | **Kobo Clara BW** (2024) |
| Device id (from UA) | `Kobo Touch 0395` |
| Panel | 6" E Ink Carta 1300, greyscale (16-level) |
| Panel resolution | **1072 × 1448** (portrait), 300 ppi |
| Firmware / software version | **4.45.23697** |
| Browser engine | **AppleWebKit/538.1** (KHTML, like Gecko) — old WebKit, ~2013–2014 era |
| Browser "Version" token | Version/4.0 Mobile Safari/538.1 |

### User-agent string (verbatim, read on-device)

```
Mozilla/5.0 (Linux; U; Android 2.0; en-us;) AppleWebKit/538.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/538.1 (Kobo Touch 0395/4.45.23697)
```

Notes:
- The `Android 2.0` / `Mobile Safari` tokens are spoofed/legacy — the real engine is **WebKit 538.1**, which is what governs JS/CSS support. Do not treat this as an Android browser.
- `Kobo Touch 0395` is the Clara BW hardware id; the trailing `4.45.23697` echoes the firmware.

### API cross-reference (acceptance criterion)

The API `eink` image profile target resolution must match this panel.

- Current API default: `IMAGE_TARGET_WIDTH=1072`, `IMAGE_TARGET_HEIGHT=1448` (`api/src/config/index.ts:52-53`).
- Clara BW panel: 1072 × 1448.
- **Result: already matches — no API config change required for KWC-101.**

---

## KWC-102 — JS/CSS capability probe

> **Done — measured on the real Kobo Clara BW** (probe run 2026-06-27). All
> values below were captured on-device by the probe page and POSTed back to the
> laptop; nothing here is a desktop assumption.

### How it was measured

`web-client/spike/kwc-102-capability-probe.html` — a single self-contained probe
page (no build, no deps), hand-written ES3/ES5-safe so it cannot crash on the
features it tests (modern syntax probed via `eval()` in `try/catch`; image
formats tested by loading real HTTP-served images and checking `naturalWidth`).
`web-client/spike/serve_probe.py` serves it over the LAN, serves the test images
at `/img/<fmt>`, and writes the device's POSTed results to
`kwc-102-results.{json,txt}`. Both are throwaway spike artifacts.

### Device user-agent (live browser)

```
Mozilla/5.0 (Unknown; Linux) AppleWebKit/538.1 (KHTML, like Gecko) Kobo eReader Safari/538.1
```

⚠️ This differs from the UA recorded under KWC-101 (the `Android 2.0 … Mobile
Safari … (Kobo Touch 0395/4.45.23697)` string). Same engine (**WebKit 538.1**),
different UA token — the live in-browser UA is the `Kobo eReader Safari/538.1`
form above. Treat **538.1** as the governing fact; do not UA-sniff for the
Android/Kobo tokens, they are inconsistent between contexts.

### Viewport

- `screen`: **1072 × 1448**, `devicePixelRatio`: **1**, `platform`: `Linux armv7l`.
- **Browser viewport (`innerWidth × innerHeight`): 732 × 762 CSS px** — markedly
  smaller than the panel, even with the `width=device-width` meta tag. Size the
  layout **relative** (`%`, `vw/vh`), never hard-code to 1072. Full-panel page
  images should be fit with `object-fit`/`width:100%`, not pixel dimensions.

### Capability report (confirmed on-device)

| JavaScript | On Kobo |
|---|---|
| ES5 baseline (forEach/map/indexOf, Object.keys, defineProperty, JSON, bind) | **yes** |
| let / const, arrow fns, template literals, default params | **no** |
| destructuring, spread/rest, classes, for…of, generators, async/await | **no** |
| Promise, Map, Set, Symbol | **no** |
| Object.assign, Array.from, Array.prototype.includes | **no** |

→ **Pure ES5.** No ES2015 syntax *or* library globals. The build must target
ES5 **and** must not assume any ES2015+ runtime (no `Promise`, `Map`, `Set`,
`Object.assign`, `Array.from`, `Array.includes`) — polyfill anything needed, or
avoid it. "Write modern, ship ancient" stands, but transpilation alone is not
enough: polyfills are required for the missing globals.

| Transport / storage | On Kobo |
|---|---|
| `fetch()` | **no** |
| `XMLHttpRequest` (verified by construction) | **yes** |
| `XMLHttpRequest` `responseType = "blob"` | **yes** |
| `URL` constructor | **no** |
| `URLSearchParams` | **no** |
| `localStorage` / `sessionStorage` | **yes** |

→ Transport is **XHR**. `responseType="blob"` works (usable for image/download
fetching). No `URL`/`URLSearchParams` — build query strings manually (with
`encodeURIComponent`) in `src/api/`. `localStorage` is available for the auth
credential (KWC-303).

> Note: the first probe run wrongly reported `XMLHttpRequest: no` because it used
> `typeof === "function"`; on this engine the XHR constructor is a host object
> whose `typeof` isn't `"function"`. Detection by construction (and the fact the
> results arrived *via* XHR) confirms it works. Probe fixed accordingly.

| CSS / layout | On Kobo |
|---|---|
| `CSS.supports()` API | **no** |
| modern flexbox (`display:flex`) | **no** |
| legacy flexbox (`display:-webkit-box`) | **yes** |
| CSS grid | **no** |
| CSS custom properties (`--var`) | **no** |
| `position: sticky` (incl. `-webkit-sticky`) | **yes** |
| `calc()`, `vw/vh`, `object-fit`, `border-radius` | **yes** |
| `transform`, `transition` (exist; **unused** — no animation on e-ink) | yes |

→ Layout uses **legacy `-webkit-box` flexbox**. No modern flex, **no grid**, **no
CSS custom properties** (use a build-time preprocessor / static values, not
runtime `--vars`), no `CSS.supports()` for feature-gating. `object-fit`, `calc`,
`vw/vh` are available and useful for fitting page images.

| Touch / events | On Kobo |
|---|---|
| `ontouchstart`, `TouchEvent` | **yes** |
| `navigator.maxTouchPoints` | absent (`undefined`) |
| `PointerEvent`, `onpointerdown` | **no** |
| `click`, `addEventListener` | **yes** |

→ Event model is **Touch Events** (`touchstart`/`touchend`), **not** Pointer
Events. `addEventListener` works. Provide a `click` fallback, but tap-zone
handling (KWC-307/505) should be built on touch events; do not rely on
`PointerEvent` or `maxTouchPoints`.

| Image format (real HTTP-served `<img>`) | Renders on panel? |
|---|---|
| PNG | **yes** |
| JPEG | **yes** |
| GIF | **yes** |
| WebP | **no** |
| AVIF | **no** |

→ The panel decodes **PNG, JPEG, GIF**. It does **not** decode **WebP or AVIF**.

> Note: the first run reported *all* formats "not rendered" — an artifact of
> using `data:` URIs (which this engine won't decode, and one of which was
> malformed). Re-tested with real HTTP image responses; the result above is the
> reliable one. WebP/AVIF genuinely fail to render.

### Decisions (the ticket's required outputs)

- **Transport — XHR.** No `fetch` on this engine. All network in `src/api/` is
  `XMLHttpRequest`-based; `responseType="blob"` is available for binary. Build
  query strings by hand (`encodeURIComponent`) — no `URL`/`URLSearchParams`.
- **Layout — legacy `-webkit-box` flexbox.** No modern flex, **no grid**, no CSS
  custom properties, no `CSS.supports()`. Size relative to the **732 × 762**
  viewport, not the 1072 panel. (Updates `web-client/CLAUDE.md` §2's "likely
  flexbox" to the confirmed `-webkit-box` variant.)
- **Image format for the `eink` profile — PNG or JPEG** (GIF also works but is
  irrelevant for manga pages). **WebP must not be used for this client.**
- **Event model — Touch Events** (`touchstart`/`touchend`) with a `click`
  fallback. Not Pointer Events.

### Build-target implication (feeds KWC-201)

ES5 target **plus polyfills** for the missing standard-library globals actually
used by the client (most likely `Promise` — needed for any async ergonomics —
and possibly `Object.assign`/`Array.from`). The bundler must not emit ES2015
syntax *or* assume ES2015 runtime APIs exist.

### API cross-reference (`eink` profile output format)

The API's `eink` profile output format **must** be one the panel decodes.

- API default: `IMAGE_EINK_FORMAT="png"` (`api/src/config/index.ts:54`) — **PNG,
  which the panel renders. Default is safe; no change required.**
- ⚠️ The API *allows* `IMAGE_EINK_FORMAT` to be set to **`webp`**
  (`api/src/config/index.ts:4,6`), and **this panel does not render WebP.**
  Setting the `eink` profile to `webp` would break the Kobo client. For any
  deployment serving this client, keep `eink` output at **png** (or `jpeg`).
  Per `web-client/CLAUDE.md` §10, this is a deployment/config constraint for the
  Kobo, not an API contract change — flag to the API epic only if a shared
  default needs guarding.

---

## KWC-103 — E-ink rendering & refresh behaviour

> **Done — measured on the real Kobo Clara BW** (probe run 2026-06-27, results in
> `web-client/spike/kwc-103-results.{json,txt}`). This is a `[DEVICE]` ticket; the
> guidance below is from the on-device pass, not a desktop assumption.

### How it is measured

`web-client/spike/kwc-103-refresh-probe.html` — a single self-contained,
hand-written ES3/ES5-safe page (no build, no deps, XHR only — same constraints as
the confirmed runtime, see KWC-102). It is **part measured, part observational**,
because an e-ink panel's refresh quality can only be judged by eye:

- **A. Image draw latency & size budget** — loads real **panel-sized (1072×1448)
  grayscale PNG** pages at four byte weights and times each `src → onload`
  (network + decode); the reader rates how each actually appeared on the panel.
- **B. Ghosting / full vs partial refresh** — swaps a high-contrast screen via a
  plain DOM update vs via a forced full-flash (paint viewport black → white →
  clear) and asks whether A ghosted through each.
- **C. Paged vs scroll** — a scrollable block vs an instant page-swap, reader
  picks which reads cleaner on the panel.
- **D. Tap responsiveness & target size** — 32/44/60/88 px targets; times
  `touchstart → handler` and records which sizes registered + the smallest
  comfortable one.
- **E. Animation policy** — a JS-stepped moving box to confirm motion smears.

`web-client/spike/serve_refresh_probe.py` serves the page over the LAN, **generates
recognizable panel-sized mock pages with the stdlib only** (no Pillow required —
each page has a frame, a large page number, count squares, two solid bars, a
noise "art" band whose height drives the byte weight, and a checkerboard footer,
so ghosting/draw quality is judgeable by eye). Measured tiers on this run:
**~60 KB / ~401 KB / ~730 KB / ~845 KB**. Results POSTed to
`kwc-103-results.{json,txt}`. A JPEG comparison is added only if Pillow is
installed (it was not; PNG is the API `eink` default anyway). Throwaway artifacts.

**To re-run it:** from `web-client/spike/`, `python3 serve_refresh_probe.py`, then
open `http://<this-mac-lan-ip>:8000/` on the Kobo, work top to bottom, tap
**SAVE RESULTS TO LAPTOP**.

### Findings — guidance (the ticket's required outputs)

**Image draw latency & size budget (section A — measured):**

| Page | Size | `src → onload` (LAN fetch + decode) | On panel |
|---|---|---|---|
| light | 60 KB | 182 ms | instant |
| medium | 401 KB | 251 ms | instant |
| dense | 730 KB | 317 ms | instant |
| heavy | 845 KB | 302 ms | instant |

- **Recommended image format — PNG.** Confirmed drawing fast and clean; matches
  KWC-102 (panel decodes PNG/JPEG/GIF, **not** WebP/AVIF) and the API `eink`
  default. Never `webp` for this client.
- **Per-page size budget — comfortable up to ~0.85 MB** at ~300 ms decode, which
  the reader rated *instant* across the whole range. Set a **soft budget of ~1 MB
  per `eink` page**; weight is not the bottleneck on this device. (Latency here is
  LAN + decode; over the Cloudflare tunnel network transfer dominates, so the
  client **prefetch** (KWC-503) still matters even though decode is cheap.)

- **Paged vs scroll — PAGED, decisively.** Not from the radio button (left blank)
  but from a **real rendering failure observed during the run:** scrolling the long
  probe page down to section C left the text **unpainted** — content only appeared
  after scrolling further (to D) forced a repaint. **This Nickel/WebKit build does
  not reliably paint content below the fold on scroll.** Long-scroll views are
  therefore unsafe; every view must fit the 732×762 viewport (or page) and advance
  by **explicit content swaps**, never long smooth scroll. (Confirms RFC §6 / CLAUDE
  §7, now with a concrete on-device reason.)

- **When to force a full refresh — on every view change and page turn.** The same
  deferred-paint behaviour shows the panel needs an **explicit repaint trigger**; a
  forced full refresh (paint viewport black → white → clear, prototyped in section
  B) on each navigation both guarantees the new content actually paints *and* clears
  any residue. Do it centrally in `render/` (KWC-307/505). Note: in-place
  high-contrast DOM swaps near the top of the page were rated **clean (no visible
  ghost)** — the Carta 1300 panel / Nickel repaint is good — but given the
  paint-reliability quirk, **force the full refresh on navigation regardless**; it
  is cheap insurance, not just ghost control.

- **Animation policy — none.** The probe's short JS slide was rated "smooth", but
  motion has no upside on e-ink and the deferred-paint behaviour makes it
  unreliable. Keep the **no-animation / no-transition** rule (RFC §6 / CLAUDE §7).

- **Safe tap-target sizing.** All four sizes (**32 / 44 / 60 / 88 px**) registered
  touches reliably and the tester found even 32 px comfortable. ⚠️ The timer
  measured tap **hold duration** (~310–345 ms finger-down→up), **not** input
  latency — so this run gives *no* latency figure, only that targets register
  cleanly. Recommendation: small targets work, but for the reader keep **large tap
  zones** (full-height left/right thirds for page turns; **≥ 44 px** for discrete
  buttons, larger preferred) for eyes-down reliability.

### API / client cross-references

- **Size budget** feeds the API `eink` encoding and the client **prefetch window**
  (CLAUDE §8 / KWC-503): ~1 MB/page is fine; decode is cheap, so the prefetch
  window is bounded by tunnel bandwidth and memory, not draw cost. Format stays
  **PNG** (never `webp`).
- **Full-refresh policy** lives once, centrally, in `render/` (KWC-307/505) — the
  black→white flash from section B, fired on every view change and page turn.
- **Scroll is unsafe on this device** — a hard constraint for the app shell and
  every view (KWC-307 onward), not a preference. See CLAUDE §12.

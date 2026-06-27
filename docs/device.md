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

> Not yet done. To be filled by the on-device probe page (ES level, fetch vs XHR, flexbox/grid, CSS custom properties, renderable `<img>` formats, touch/event model). WebKit 538.1 implies an ES5-era build target, but **confirm on-device before relying on it**.

---

## KWC-103 — E-ink rendering & refresh behaviour

> Not yet done. To be filled by the on-device refresh probe (full vs partial refresh, ghosting, paged vs scroll, tap responsiveness, image draw latency, recommended image format + per-page size budget).

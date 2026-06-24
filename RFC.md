# RFC: Kobo Manga Reader ("KoManga")

**Status:** Draft
**Author:** Matt
**Last updated:** 2026-06-24
**Scope:** Architecture & planning only. Implementation tasks tracked separately in `TASKS.md`.

---

## 1. Summary

A self-hosted manga reading system that brings Tachiyomi/Mihon-style source browsing to a Kobo e-reader. The Kobo runs a lightweight web client; all heavy work (source scraping, image fetching, processing) is outsourced to a server stack running on a Mac Mini. Suwayomi-Server provides the Tachiyomi source engine; a Node/TypeScript API wraps it in a Kobo-optimised REST layer.

The defining constraint is the Kobo's hardware: a slow ARM SoC, an old WebKit browser, and an e-ink display. Every architectural decision flows from keeping the client thin and the display happy.

---

## 2. Goals & Non-Goals

### Goals
- Browse and search Tachiyomi/Mihon sources from the Kobo.
- Stream manga pages on demand without downloading whole chapters first.
- Optionally download a full chapter as a CBZ for offline keeping.
- Sync reading progress server-side so it's consistent across devices.
- Single-user, publicly reachable, secured.
- Run as a reproducible Docker Compose stack on the Mac Mini.

### Non-Goals (for v1)
- Multi-user accounts or sharing.
- Reading inside KOReader (we render in our own client).
- Native Kobo app or KOReader plugin.
- Offline-first client (network dependency is acceptable).
- Bundling/redistributing source extensions ourselves (Suwayomi handles sources).
- Building the web/mobile clients (future epic — see §13).

---

## 3. High-Level Architecture

```
┌─────────────┐      HTTPS       ┌──────────────────────────────────────┐
│   Kobo      │ ───────────────► │           Mac Mini (Docker)          │
│ web client  │                  │                                       │
│ (WebKit)    │ ◄─────────────── │  ┌─────────────┐   ┌───────────────┐ │
└─────────────┘   REST + images  │  │ Cloudflare  │──►│  Node/TS API  │ │
                                  │  │   Tunnel    │   │ (REST wrapper)│ │
                                  │  └─────────────┘   │   + SQLite    │ │
                                  │                     └───────┬───────┘ │
                                  │                       GraphQL │       │
                                  │                     ┌────────▼──────┐ │
                                  │                     │   Suwayomi    │ │
                                  │                     │    Server     │ │
                                  │                     │ (Tachiyomi    │ │
                                  │                     │   sources)    │ │
                                  │                     └───────────────┘ │
                                  └───────────────────────────────────────┘
```

### Components

**Suwayomi-Server (Docker)**
Runs the real Tachiyomi/Mihon source extensions on the JVM. Manages source installation, catalogue browsing, search, chapter listing, and raw page fetching. Exposes a GraphQL API. We treat it as an upstream dependency and never expose it directly to the client.

**Node/TS API (Docker) — the heart of this project**
- Exposes a clean REST API shaped for the Kobo client.
- Talks to Suwayomi internally over GraphQL.
- Performs e-ink image processing (greyscale, contrast, resize to Kobo resolution, format conversion).
- Manages the ephemeral page/session cache and its pruning.
- Builds CBZ files for explicit chapter downloads.
- Owns reading-progress and download metadata in SQLite.
- Enforces single-user auth and rate limiting.

**Kobo web client**
Static HTML/CSS/JS, deliberately minimal, targeting old WebKit. Two main surfaces: a browse/search/library view and a page reader. Tap-based navigation, no animations, designed around e-ink refresh behaviour.

**Cloudflare Tunnel**
Public entry point. No inbound ports on the home router; the Mac Mini originates an outbound tunnel. TLS handled by Cloudflare. Cloudflare Access can sit in front as an additional auth gate.

---

## 4. Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Client type | Web app via Kobo browser | Avoids Lua/KOReader toolkit and ARM cross-compilation; browser handles rendering |
| Reading model | On-demand page streaming + optional CBZ download | Matches "view without downloading whole thing"; download is an explicit action |
| API style | REST wrapper over Suwayomi GraphQL | Lightweight for old WebKit; decouples client from Suwayomi schema; lets us shape endpoints (e.g. pre-processed images) |
| Source engine | Suwayomi-Server | Runs real Tachiyomi sources via JVM; mature, exactly the needed capability |
| API stack | Node.js / TypeScript | Per requirement; strong image-processing and HTTP ecosystem |
| Our data store | SQLite | Single-user; file-based; trivial Docker volume + backup. Suwayomi keeps its own store |
| Auth model | Single-user credential | No user management needed |
| Progress | Server-side, device-agnostic | Keyed by manga/chapter/page, not by device, so sync works across clients |
| Public exposure | Cloudflare Tunnel | No open ports, auto-TLS, optional Access gate, home IP hidden |
| Deployment | Full Docker Compose | Reproducible single-host stack |

---

## 5. Reading Flow (the critical path)

### 5.1 Streaming a chapter (default)
1. Client requests chapter page list: `GET /api/chapter/:id/pages` → returns page count + page IDs/URLs (no image data).
2. Client requests pages one (or a small window) at a time: `GET /api/page/:id`.
3. API checks session cache → if miss, fetches raw page from Suwayomi → processes for e-ink → stores in session cache → returns.
4. API prefetches the next N pages in the background to mask latency.
5. On session end (or TTL/size limit), the session cache is pruned.

### 5.2 Downloading a chapter (explicit)
1. Client calls `POST /api/chapter/:id/download`.
2. API fetches all pages from Suwayomi, processes them, and bundles into a CBZ.
3. CBZ is stored persistently (separate from the ephemeral session cache) and recorded in SQLite.
4. Downloaded chapters are served from disk and survive cache pruning.

### 5.3 Cache strategy
- **Session/ephemeral cache:** processed pages for the current reading session, **keyed by page + profile** (a `raw` page and its `eink` render are distinct entries). Bounded by size and TTL; pruned aggressively. This is what makes "view without downloading" cheap.
- **Persistent download store:** CBZs the user explicitly chose to keep. Never auto-pruned.
- Both keyed so the same processed page is never recomputed unnecessarily within its lifetime.

---

## 6. Image Processing for E-Ink

A page-processing pipeline in the Node API, because raw source images are colour, high-resolution, and JPEG/WebP-heavy — wrong on every axis for e-ink. **Processing is an opt-in transform, not a mandatory step**, because future clients (web, mobile — see §13) will want full-colour pages. The API serves pages under a selectable **profile**:

- `raw` — original page (or lossless passthrough), for full-colour clients that process client-side.
- `eink` — greyscale, resized/fit to the Kobo panel resolution, contrast tuned for e-ink, output in a compact format old WebKit reliably renders (likely PNG or low-chroma JPEG).

Profile is negotiated per request (e.g. `GET /api/page/:id?profile=eink`). The Kobo client requests `eink`; the default is `raw`. Reading direction (right-to-left) metadata comes from the API; ordering display is a client concern.

This profile split is the main reason a thin client + fat server works for the Kobo *without* locking future clients into greyscale: the Kobo receives images already optimised for its screen, while a web/mobile client can take raw pages and decide for itself.

---

## 7. Data Model (our SQLite — not Suwayomi's)

- **reading_progress** — `manga_id`, `chapter_id`, `page`, `updated_at`. Device-agnostic; last-write-wins (sufficient for single user).
- **downloads** — `chapter_id`, `manga_id`, `cbz_path`, `status`, `created_at`.
- **cache_index** — bookkeeping for the ephemeral session cache (keys, sizes, TTLs) to drive pruning.

Source/catalogue/chapter metadata is *not* duplicated here; it's queried from Suwayomi on demand (with short-lived caching where it helps).

---

## 8. API Surface (indicative)

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/sources` | List installed sources |
| `GET` | `/api/search?q=&source=` | Search a source |
| `GET` | `/api/manga/:id` | Manga details + chapter list |
| `GET` | `/api/chapter/:id/pages` | Page list (metadata only) |
| `GET` | `/api/page/:id?profile=` | Single page image; `profile=raw` (default) or `eink` |
| `POST` | `/api/chapter/:id/download` | Build + store CBZ |
| `GET` | `/api/downloads` | List downloaded chapters |
| `GET`/`PUT` | `/api/progress/:mangaId` | Read/update reading progress |
| `GET` | `/api/library` | Saved/followed manga |

All endpoints sit behind auth. The exact shapes get finalised during implementation.

---

## 9. Security

Public exposure makes this first-class, not an afterthought:
- **Cloudflare Tunnel** — no inbound ports; home IP hidden.
- **Single-user auth** — a credential/token required on every API call. Optionally fronted by Cloudflare Access.
- **TLS** — terminated by Cloudflare.
- **Rate limiting** — protects both our API and the upstream sources from abuse/runaway clients.
- **Suwayomi is never directly exposed** — only reachable from the Node API inside the Compose network.
- **Secrets** — auth credentials/tokens via environment/secret files, never committed.

---

## 10. Deployment

Single `docker-compose.yml` on the Mac Mini:
- `suwayomi` — source engine; internal network only; named volume for its data.
- `api` — Node/TS service; mounts SQLite volume + download store; depends on `suwayomi`.
- `cloudflared` — Cloudflare Tunnel connector pointing at the `api` service.

Volumes for: Suwayomi data, our SQLite DB, the persistent CBZ download store. The ephemeral session cache can live on a volume or tmpfs depending on size.

---

## 11. Risks & Open Questions

- **Old WebKit limits** — exact JS/CSS feature support on the Kobo browser is uncertain; may constrain client framework choice (likely vanilla or a tiny lib). *Validate early with a spike on the actual device.*
- **E-ink rendering quality** — processing parameters will need real-device tuning; what looks right on a monitor won't on e-ink.
- **Suwayomi schema drift** — GraphQL schema may change across versions; the REST wrapper isolates this but the adapter needs maintenance.
- **Source reliability & legality** — sources are third-party scrapers; they break and raise content-rights considerations. This system is for personal use; respect local law and source terms.
- **Latency masking** — prefetch tuning matters a lot for perceived speed on e-ink.
- **Kobo resolution targeting** — needs to be configurable per model; confirm the exact target device.

---

## 12. Phasing (informs the task list)

1. **Infra spike** — Compose stack up: Suwayomi reachable from a stub Node API; Cloudflare Tunnel live; auth skeleton.
2. **Browse path** — sources, search, manga details, chapter list end-to-end (no images yet).
3. **Reading path** — page metadata, single-page streaming, image processing pipeline, session cache + prefetch.
4. **Download path** — CBZ build + persistent store.
5. **Progress sync** — SQLite-backed progress read/write.
6. **Kobo client** — browse UI, then reader UI, device-tuned.
7. **Hardening** — rate limiting, cache pruning, e-ink tuning on real hardware.

---

## 13. Future Epics (out of scope for v1, but shaping the design)

These are **not** being designed or built now, but the v1 API is being kept deliberately client-agnostic so they slot in without a rewrite.

- **Manga reading website** — a full-colour browser client. Will consume the same API; page processing may happen client-side or server-side depending on efficiency, which is exactly why page serving is profile-based (`raw` vs `eink`) rather than hardcoded to e-ink.
- **Mobile app** — same story: consumes the same API, likely requests `raw` pages and processes/displays in full colour on-device.

Implications already accounted for in v1:
- Page serving is profile-negotiated, not e-ink-only (§6).
- Reading progress is device-agnostic and server-side, so it syncs across Kobo + web + mobile (§7).
- Auth is single-user but multi-client — the token scheme assumes multiple devices, not one (§9).
- The REST surface is shaped for generic clients, with the Kobo being just the first consumer.

When these epics begin, expected additions (not designed here): richer library/metadata endpoints, possibly colour-aware caching profiles, and client-specific concerns (responsive layout, native rendering). The core API contract should remain stable.

---

*Next deliverables (separate documents): `CLAUDE.md` (project conventions/context for AI-assisted work) and `TASKS.md` (Jira-style, small, testable tasks derived from the phasing above).*

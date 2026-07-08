# RFC: Kobo Manga Reader ("KoManga")

**Status:** Draft
**Author:** Matt
**Last updated:** 2026-07-08
**Scope:** Architecture & planning only. Implementation tasks tracked separately in `TASKS.md`.

---

## 1. Summary

A self-hosted manga reading system that brings Tachiyomi/Mihon-style source browsing to a Kobo e-reader. The Kobo reads through a KOReader plugin client; all heavy work (source scraping, image fetching, processing) is outsourced to a server stack running on a Mac Mini. Suwayomi-Server provides the Tachiyomi source engine; a Node/TypeScript API wraps it in a Kobo-optimised REST layer.

The defining constraint is the Kobo's hardware: a slow ARM SoC and an e-ink display. Every architectural decision flows from keeping the client thin and the display happy.

> **Reconciled 2026-07-06 (API-807):** the original client was a **web client** running in the Kobo's Nickel browser, and much of this RFC below is written in those terms. That epic was **retired** — the web-client device spike proved Nickel's browser chrome and 732×762 viewport can't be escaped from a web page (see §2), so the **KOReader plugin** (§13, `koreader-plugin/`) is now the **sole Kobo client**. Read the "web client" throughout this document as **historical**: the API's REST contract is client-generic and unchanged, and the plugin consumes it exactly as the web client would have. `docs/device.md` (written by the web-client spike) survives as the shared panel-capability record. The old WebKit constraint no longer applies.

---

## 2. Goals & Non-Goals

### Goals
- Browse and search Tachiyomi/Mihon sources from the Kobo.
- Stream manga pages on demand without downloading whole chapters first.
- Optionally download a full chapter as a CBZ for offline keeping.
- Sync reading progress server-side so it's consistent across devices.
- Optionally push completed chapter progress one-way to AniList.
- Single-user, publicly reachable, secured.
- Run as a reproducible Docker Compose stack on the Mac Mini.

### Non-Goals (for v1 of the web-client path)
- Multi-user accounts or sharing.
- Offline-first client (network dependency is acceptable). *(Reconciled 2026-07-05 for the KOReader-plugin epic — that client adds device-local offline downloads; see the note below and §5.4.)*
- Bundling/redistributing source extensions ourselves (Suwayomi handles sources).
- Building the web/mobile clients (future epics — see §13).

> **Reconciled 2026-06-28:** the original v1 scope listed "reading inside KOReader" and "native Kobo app or KOReader plugin" as non-goals — the web client was meant to render its own pages in the Nickel browser. The web-client device spike then found Nickel exposes only a 732×762 viewport on the 1072×1448 panel and surrounds it with browser chrome a page cannot hide. A **KOReader plugin client** is therefore now an **active, separate epic** (`koreader-plugin/`), sharing the same API — see §13. It *does* read inside KOReader (via KOReader's native CBZ reader). This does not change the API contract or the web-client epic.

> **Reconciled 2026-07-05:** the "offline-first client" non-goal held for the **web client** (Nickel browser, always-online reading). The **KOReader plugin** is different: it exists for full-panel reading on a Kobo that is routinely used with wifi asleep or absent, so *offline reading of explicitly-downloaded chapters* is now in scope **for that client** (feature `KRP-8xx`). It stays a **client concern** — the plugin persists downloaded `eink` CBZs on the device and keeps a local index (§5.4); it needs **no new API endpoint** and does not change the contract. The system is still not "offline-first" in general (browse/search/streaming remain online); only kept downloads read offline.

---

## 3. High-Level Architecture

```
┌─────────────┐      HTTPS       ┌──────────────────────────────────────┐
│   Kobo      │ ───────────────► │           Mac Mini (Docker)          │
│  KOReader   │                  │                                       │
│   plugin    │ ◄─────────────── │  ┌─────────────┐   ┌───────────────┐ │
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
Runs the real Tachiyomi/Mihon source extensions on the JVM. Manages source installation, catalogue browsing, search, chapter listing, and raw page fetching. Exposes a GraphQL API plus its own admin WebUI. We treat it as an upstream dependency and never expose it directly to the Kobo client.

> **Reconciled 2026-07-07 (API-809):** source-extension management is Suwayomi's job and needs the Suwayomi admin WebUI. The "never expose Suwayomi" rule means **never expose it unauthenticated**, never publish inbound router ports, and never make it reachable by the Kobo client. The single allowed public reachability is the Suwayomi admin WebUI through the Cloudflare Tunnel, gated by a Cloudflare Access policy that admits only the owner. Content and reading traffic remain unchanged: Kobo client → API REST surface → Suwayomi over the internal Compose network.

**Node/TS API (Docker) — the heart of this project**
- Exposes a clean REST API shaped for the Kobo client.
- Talks to Suwayomi internally over GraphQL.
- Performs e-ink image processing (greyscale, contrast, resize to Kobo resolution, format conversion).
- Manages the ephemeral page/session cache and its pruning.
- Builds CBZ files for explicit chapter downloads.
- Owns reading-progress and download metadata in SQLite.
- Links to AniList, stores manga matches, and pushes completed chapter progress.
- Enforces single-user auth and rate limiting.

**Kobo client** *(historical: web client — retired, see §1/§13)*
Originally a deliberately-minimal static HTML/CSS/JS web app targeting old WebKit, with two surfaces (browse/search/library and a page reader). Superseded by the **KOReader plugin** (§13), which runs full-panel inside KOReader and reads chapters through KOReader's native CBZ reader. The API's REST + image surface it consumes is unchanged.

**Cloudflare Tunnel**
Public entry point. No inbound ports on the home router; the Mac Mini originates an outbound tunnel. TLS handled by Cloudflare. The Kobo-facing API remains behind the API's own single-user auth, and the Suwayomi admin WebUI may be routed through the same tunnel only when protected by Cloudflare Access for the owner identity.

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

### 5.4 Offline device-local downloads (KOReader plugin)

The download store in §5.2 is **server-side**: the CBZ lives on the API host and is re-fetched over the network when opened, so it does not enable reading with the network down. The **KOReader plugin** additionally supports **true offline reading**, because a Kobo is routinely used with wifi asleep or absent and full-panel offline reading is the reason the epic exists. For that client:

1. "Download for offline" fetches the chapter's built **`eink` CBZ** — the transient `GET /api/chapter/:id/cbz?profile=eink` (§8; already built and served from the session cache, creating **no** server-side download record) — and **persists the bytes on the device**, under KOReader's data directory.
2. The plugin keeps a **device-local download index** (chapter id, manga id, title, chapter number, reading direction, local file path, size, timestamp) so the "Downloaded" list renders **and opens without contacting the API**.
3. Opening a downloaded chapter reads the **local CBZ** directly through KOReader's reader — no network.
4. The user can **delete** a downloaded chapter, freeing device storage (removes both the file and the index entry).

This keeps offline behaviour a **client concern** (§13): it needs **no new API endpoint** (the transient `eink` CBZ already exists) and does not change the contract. The **server-side** persistent download store (§5.2, §7, §8) remains available for potential full-colour clients (website/mobile) but is **not** what the KOReader plugin relies on for offline reading. *(Open question: if no client ends up using the server-side store, it may be retired in a later API-epic cleanup.)*

### 5.5 Tracker sync (AniList)

Tracker support is deliberately narrow for v1: **one-way KoManga → AniList**
chapter-completion sync. KoManga does not import AniList lists into the library,
does not overwrite local reading progress from AniList, and does not perform
multi-tracker fan-out yet.

Account linking uses AniList OAuth:

1. An authenticated client starts a link session with
   `POST /api/tracker/anilist/link`.
2. The API returns a short-lived `sessionId` and a protected QR PNG URL. The QR
   encodes the AniList authorize URL with the `sessionId` as OAuth `state`.
3. The user scans the QR and approves the AniList app.
4. AniList redirects back to the API's public callback,
   `GET /api/tracker/anilist/callback?code=&state=`.
5. The API accepts the callback only if the `state` is known, unexpired, and not
   already consumed; then it exchanges the code server-side and stores the
   resulting AniList account token.

Manga matching is explicit. The API can search AniList candidates using the
Suwayomi manga title, but the user confirms the media id per manga. A manga can
also be marked "do not track" so future completion sync skips it.

Completion sync happens only after KoManga knows a chapter is complete. The API
looks up the chapter's manga, the linked AniList account, and the confirmed manga
match; unmatched, unlinked, or do-not-track manga are ignored. It sends the
highest completed chapter number forward only when that number is greater than
both the locally recorded `last_synced_chapter` and AniList's current list
progress. If the completed chapter reaches AniList's known total chapter count,
the remote status becomes `completed`; otherwise it remains/sets `reading`.
Tracker failures are logged and do not block local reading.

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
- **downloads** — `chapter_id`, `manga_id`, `cbz_path`, `status`, `created_at`. *(This is the **server-side** download store. The KOReader plugin keeps its own **device-local** download index for offline reading — §5.4 — which is not recorded in this SQLite DB.)*
- **cache_index** — bookkeeping for the ephemeral session cache (keys, sizes, TTLs) to drive pruning.
- **library** — followed manga ids plus lightweight local display/cache fields owned by KoManga.
- **tracker_account** — one row per tracker service (currently `anilist`) with
  OAuth access token metadata and AniList user id. Single-user account storage
  means relinking replaces the previous service row.
- **tracker_link** — per manga tracker metadata: service, confirmed AniList
  media id (nullable while unmatched), `last_synced_chapter`, and
  `do_not_track`.

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
| `GET` | `/api/chapter/:id/cbz?profile=` | Built CBZ for a chapter (transient; no download record). Used for reading and for the KOReader plugin's device-local offline download (§5.4) |
| `POST` | `/api/chapter/:id/download` | Build + store CBZ (server-side download store) |
| `GET` | `/api/downloads` | List server-side downloaded chapters |
| `GET`/`PUT` | `/api/progress/:mangaId` | Read/update reading progress |
| `GET` | `/api/library` | Saved/followed manga |
| `POST` | `/api/tracker/anilist/link` | Start an AniList OAuth link session; returns a session id and QR URL |
| `GET` | `/api/tracker/anilist/link/:sessionId/qr.png` | Protected QR PNG for the AniList authorize URL |
| `GET` | `/api/tracker/anilist/link/:sessionId/status` | Poll account-link status (`pending`, `linked`, `expired`) |
| `GET` | `/api/tracker/anilist/callback?code=&state=` | Public AniList OAuth callback; validates single-use short-TTL state |
| `GET` | `/api/tracker/manga/:mangaId/candidates` | Search AniList candidate matches for a Suwayomi manga |
| `GET` | `/api/tracker/manga/:mangaId/status` | Read account/match/do-not-track tracking state for one manga |
| `PUT`/`DELETE` | `/api/tracker/manga/:mangaId/match` | Confirm or clear the AniList media match |
| `POST` | `/api/tracker/manga/:mangaId/do-not-track` | Dismiss tracking for this manga |
| `POST` | `/api/tracker/complete` | Accept a local chapter-complete event and asynchronously push eligible progress to AniList |

All `/api/*` endpoints sit behind auth except the AniList OAuth callback, which
must be callable by AniList and exposes no stored data. The exact shapes get
finalised during implementation.

---

## 9. Security

Public exposure makes this first-class, not an afterthought:
- **Cloudflare Tunnel** — no inbound ports; home IP hidden.
- **Single-user auth** — a credential/token required on every API call. Optionally fronted by Cloudflare Access.
- **AniList OAuth callback carve-out** — `GET /api/tracker/anilist/callback`
  is the only public unauthenticated `/api/*` route. AniList cannot send
  KoManga's bearer token back during OAuth. The route accepts only `code` and
  `state`, exposes no library/account data, and succeeds only for a single-use,
  short-TTL state created by an authenticated link-session request.
- **TLS** — terminated by Cloudflare.
- **Rate limiting** — protects both our API and the upstream sources from abuse/runaway clients.
- **Suwayomi is never exposed unauthenticated** — the Kobo client never reaches it directly, no inbound router ports are opened for it, and content/reading traffic reaches it only from the Node API inside the Compose network.
- **Suwayomi admin WebUI exception** — the WebUI may be publicly reachable only through the Cloudflare Tunnel and only behind a Cloudflare Access policy that admits the owner. Suwayomi has no auth of its own, so Cloudflare Access is mandatory for that surface.
- **Secrets** — auth credentials/tokens via environment/secret files, never committed.

> **Reconciled 2026-07-07 (API-809):** RFC §9 previously said Suwayomi was "never directly exposed". The security invariant is narrower: Suwayomi is never exposed to the Kobo client or the unauthenticated internet. Owner-only WebUI access through Cloudflare Access is allowed so sources can be installed and managed without adding source-management responsibilities to the API.

---

## 10. Deployment

Single `docker-compose.yml` on the Mac Mini:
- `suwayomi` — source engine; no default host/public port; named volume for its data. Its GraphQL/content path stays internal to the Compose network. Its admin WebUI may be routed by `cloudflared` only behind Cloudflare Access.
- `api` — Node/TS service; mounts SQLite volume + download store; depends on `suwayomi`. AniList OAuth config (`ANILIST_CLIENT_ID`, `ANILIST_CLIENT_SECRET`, `ANILIST_REDIRECT_URI`) is passed only to this service; the client secret stays server-side.
- `cloudflared` — optional Cloudflare Tunnel connector. In the tunnel profile, it routes the API hostname to `api` and may also route a separate owner-only Suwayomi WebUI hostname to `suwayomi:4567`.

Volumes for: Suwayomi data, our SQLite DB, the persistent CBZ download store. The ephemeral session cache can live on a volume or tmpfs depending on size.

AniList linking requires the OAuth redirect URI to be publicly reachable. Use
the existing API hostname routed to `api:3000` by `cloudflared`, e.g.
`https://manga.example.com/api/tracker/anilist/callback`; do **not** create a
new callback hostname. A local-only stack can still browse/read, but QR/OAuth
linking will not complete unless the tunnel (or an equivalent HTTPS public API
route) is up and the same callback URL is registered in AniList.

> **Reconciled 2026-07-07 (API-809):** API-808 made `cloudflared` optional for local-only runs. In a local-only deployment with no tunnel profile, there is no public Suwayomi WebUI route. The fallback stance is loopback-only maintenance access from the Mac Mini host, never LAN/public binding: a later Compose ticket may add an explicit opt-in local maintenance profile or document an SSH/loopback workflow, but the default stack keeps Suwayomi without a host port.

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

The v1 API is kept deliberately client-agnostic so additional clients slot in without a rewrite. One of these has already been promoted to an active epic (the KOReader plugin); the others remain future work.

- **KOReader plugin (Kobo) — ACTIVE epic (`koreader-plugin/`, `KRP-NNN`).** A native-feel Kobo client that runs inside KOReader and uses the **full e-ink panel**, instead of the Nickel browser the web client is constrained by. It exists because the web-client device spike proved Nickel's chrome and 732×762 viewport can't be escaped from a web page (§2, reconciled). It consumes the **same API** (requests the `eink` profile; device-agnostic progress; single credential) and reads chapters through **KOReader's native CBZ reader** — the API already builds `eink` CBZs (§5.2), so the heavy reader work is inherited rather than rebuilt. On-demand streaming is a refinement on top. It does **not** change the API contract; gaps are raised as API-epic tickets. This epic also adds **offline reading** as a **client-side** concern: the plugin persists downloaded `eink` CBZs on the device with a local index and a delete action, so kept chapters open with the network off (§5.4) — again with no API change.
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

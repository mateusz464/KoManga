# CLAUDE.md — KoManga API

> Project context and conventions for the **API epic**. Read this before working any `API-NNN` ticket. The authoritative _what_ lives in `RFC.md` and `TASKS.md`; this file is the _how_.

---

## 1. What this service is

The Node/TypeScript API is the layer between the Kobo client and **Suwayomi-Server**. It:

- Exposes a clean **REST** API shaped for thin clients (the Kobo first; a website and mobile app later).
- Talks to Suwayomi internally over **GraphQL**.
- Processes manga page images, with e-ink processing as an **opt-in profile**, not a default.
- Manages an **ephemeral session cache** for streaming and a **persistent CBZ store** for explicit downloads.
- Owns **reading progress, library, and download** records in **SQLite**.
- Is **single-user but multi-client**, **publicly exposed** via Cloudflare Tunnel, and therefore secured.

**Suwayomi is never exposed publicly.** It is reachable only from this service on the internal Docker network.

---

## 2. Tech stack (do not substitute without updating this file)

| Concern          | Choice                                    |
| ---------------- | ----------------------------------------- |
| Language         | TypeScript (strict)                       |
| Runtime          | Node.js (LTS)                             |
| HTTP framework   | Express                                   |
| Architecture     | Layered: **routes → services → adapters** |
| Suwayomi client  | `graphql-request`                         |
| Image processing | `sharp`                                   |
| Database         | SQLite via `better-sqlite3`               |
| Migrations       | Plain SQL, run on startup                 |
| Tests            | Vitest                                    |
| Container        | Docker, orchestrated by Compose           |
| Public entry     | Cloudflare Tunnel (`cloudflared`)         |

---

## 3. Architecture & layering

Strict one-directional dependency flow. **An inner layer never imports an outer one.**

```
routes/      HTTP only: parse/validate input, call a service, shape the response.
             No business logic. No direct Suwayomi/DB/sharp calls.
services/    Business logic. Orchestrates adapters. Knows nothing about Express
             (no req/res). Pure, testable functions/classes.
adapters/    The outside world behind interfaces: Suwayomi (GraphQL), SQLite
             repositories, image processing, cache. Each defined by a port.
```

- **Ports & adapters.** Every external dependency (Suwayomi, DB, image processor, cache) is defined as a **TypeScript interface (a "port") in the service layer**, and implemented by a concrete adapter. Services depend on the interface, never the concrete class. This is what makes the TDD tasks possible — tests inject mocks of the ports.
- **Dependency injection by construction.** Wire concrete adapters to services at startup (a small composition root). No service reaches out and constructs its own adapter; it receives them. No global singletons for external dependencies.
- **Express stays at the edge.** `req`/`res` never travel past the routes layer. Services receive plain typed arguments and return plain typed values or throw typed errors.

### Suggested folder layout

```
src/
  routes/            # express routers, one per feature area
  services/          # business logic + port interfaces
    ports/           # interfaces: SuwayomiClient, *Repository, ImageProcessor, SessionCache
  adapters/
    suwayomi/        # graphql-request implementation of SuwayomiClient
    db/              # better-sqlite3 repositories + migrations/
    images/          # sharp implementation of ImageProcessor
    cache/           # session cache implementation
  config/            # typed config loader (§5)
  http/              # app factory, middleware, error handler
  index.ts           # composition root + server start
test/                # mirrors src/ ; unit + endpoint tests
docs/                # device.md etc. (cross-epic)
```

---

## 4. TDD workflow (strict — non-negotiable)

The task list pairs a `[TEST]` ticket with its implementation ticket. The discipline:

1. **Test ticket first.** Write tests that encode the agreed contract for the unit/endpoint. They must **fail** (red) because the implementation doesn't exist or is a stub.
2. **Impl ticket second.** Write the minimum code to make those tests pass (green). Refactor with tests green.
3. An impl ticket is **not Done** until _all_ of its paired test ticket's assertions pass.
4. **Mock at the port boundary**, not deeper. Service tests mock the Suwayomi/DB/image/cache ports. Adapter tests exercise the real library against controlled inputs (fixtures, temp DB, a live Suwayomi where the ticket says so).
5. Endpoint tests go through Express (supertest-style) with services/ports mocked, asserting status codes and the response envelope (§6).

Do not write implementation ahead of its test ticket. Do not weaken a test to make code pass.

---

## 5. Configuration & secrets

- All config flows through **one typed module** in `src/config`. Never read `process.env` elsewhere.
- **Fail fast:** missing a required variable throws a descriptive error at startup, before the server listens.
- Every variable is documented in `.env.example`. Required at minimum: Suwayomi URL, the single-user auth credential/token, cache size/TTL limits, prefetch window, image target resolution/format, server port, paths for the SQLite file and the CBZ store.
- **Secrets are never committed** and never logged. The auth credential comes from env/secret file only.

---

## 6. HTTP & error conventions

- **Response envelope:** consistent JSON shape for success and error across every endpoint (defined and tested in API-104/105). All endpoints conform.
- **Status codes:** `400` invalid input, `401` missing/invalid auth, `404` unknown resource, `429` rate-limited, `500` unexpected. Map thrown typed errors to these centrally in the error middleware.
- **No leaks:** stack traces and internal/Suwayomi error details never reach the client. Log them server-side; return a safe message.
- **Validation at the edge:** routes validate and coerce input before calling a service. Services may assume valid inputs.
- **Typed errors:** services throw typed/domain errors; the error middleware is the single place that maps them to HTTP responses.

### Image profiles (core contract — see RFC §6)

- `GET /api/page/:id?profile=` serves a page. `profile=raw` (default) or `profile=eink`.
- **`raw`** = source bytes / lossless passthrough — for future full-colour clients that process client-side.
- **`eink`** = greyscale, resized-to-fit the configured Kobo resolution, contrast-tuned, compact output format.
- Processing lives behind the `ImageProcessor` port so it is reusable by future server-side clients. **Never hardcode e-ink as the only path.**

---

## 7. Caching & reading model (RFC §5)

- **Session/ephemeral cache:** processed pages for the current reading session, **keyed by page id + profile** (`raw` and `eink` of the same page are distinct entries). Bounded by size + TTL; pruned aggressively. Behind the `SessionCache` port.
- **Persistent download store:** CBZs the user explicitly chose to keep. Lives on its own Docker volume. **Never** auto-pruned by the session-cache logic. Downloaded chapters serve from here, not the session cache.
- **Prefetch:** requesting page N triggers background prefetch of the next configurable window into the session cache; it must **not** block page N's response.
- Keep the two stores conceptually and physically separate. Never let session-cache eviction touch the persistent store.

---

## 8. Data ownership (RFC §7)

- This service's SQLite owns **only** what is ours: `reading_progress`, `downloads`, `library`/follows, and `cache_index` bookkeeping.
- **Do not duplicate** Suwayomi's catalogue/source/chapter metadata; query Suwayomi for it (with short-lived caching only where it clearly helps).
- **Reading progress is device-agnostic** — keyed by manga/chapter/page, never by device id. **Last-write-wins** via `updated_at`. This is what lets Kobo + web + mobile share one position.
- All DB access goes through **repository interfaces** (ports). No raw SQL in services or routes.

---

## 9. Security (RFC §9 — first-class, not an afterthought)

- **Auth on every `/api/*` route.** A valid single-user credential/token is required; `/health` is the only public route. The scheme must **not assume one device** (multi-client).
- **Rate limiting** on API routes, configurable, returning `429` over the limit.
- **Suwayomi never publicly reachable** — internal Docker network only.
- **TLS terminated by Cloudflare**; no inbound ports opened on the home router.
- Credentials from config/secret only; never hardcoded, never logged.

---

## 10. Multi-client future (RFC §13) — design rules to honour now

A website and mobile app will consume this same API later. To avoid a rewrite:

- Keep the REST surface **generic** — the Kobo is just the first consumer, not the design centre.
- Page serving stays **profile-negotiated**, never e-ink-only.
- Progress/library stay **device-agnostic and server-side**.
- Auth stays **single-user but multi-client**.
- Keep the `ImageProcessor` reusable so server-side processing could move to a shared library without changing the contract.

Do not build website/mobile features now — just don't foreclose them.

---

## 11. Coding standards

- **Comments only for complex code that isn't understandable without them.** Do NOT narrate obvious lines, restate what the code says, or add a comment above every step/file. A comment must earn its place by explaining a non-obvious _what_ or _why_; otherwise leave it out. Before writing any comment, ask "is this code genuinely unreadable without it?" — if not, delete it.
- **TypeScript strict mode on.** No `any` in committed code unless justified with a comment; prefer precise types at boundaries.
- **Lint + format must pass** before a ticket is Done (`npm run lint`, `npm run format`).
- Small, focused modules; a file does one job. Favour pure functions in services.
- Name things by domain (`SuwayomiClient`, `ReadingProgressRepository`, `ImageProcessor`), not by library.
- No business logic in routes; no Express in services; no external library types leaking across a port boundary (map to domain types in the adapter).
- Handle and type errors explicitly; don't swallow them.

---

## 12. Definition of Done (every API ticket)

- [ ] Paired `[TEST]` ticket's assertions all pass (for impl tickets).
- [ ] New code covered by tests at the right layer (port-mocked for services, real lib for adapters).
- [ ] Lint + format + type-check clean.
- [ ] Conforms to the response envelope and error mapping (§6) where it touches HTTP.
- [ ] No secrets, no stack-trace leaks, no `process.env` outside config.
- [ ] External dependencies sit behind a port; nothing constructs its own adapter.
- [ ] Respects layering (routes → services → adapters, one-directional).
- [ ] Docs/`.env.example` updated if config or contracts changed.

---

## 13. Gotchas / notes

- **`sharp` in Docker:** native libvips binary — ensure the image installs/builds it for the container's architecture (the Mac Mini is ARM). Pin the version; verify the build in CI/Compose.
- **`better-sqlite3` is synchronous** — fine for single-user, but keep heavy calls off the hot request path where it matters; it also has a native build, same Docker caveat.
- **Suwayomi schema drift:** the GraphQL schema can change across versions. All coupling lives in the `suwayomi` adapter — keep it there so a schema change breaks one module, not the app.
- **Don't expose Suwayomi GraphQL through our API** — the client only ever sees our REST surface.

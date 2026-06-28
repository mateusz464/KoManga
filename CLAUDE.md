# CLAUDE.md — KoManga (monorepo root)

> This is a **monorepo router**. The detailed conventions live in each subproject. Read the `CLAUDE.md` inside the folder you are working in before doing any work.

---

## What KoManga is

A self-hosted manga reading system that brings Tachiyomi/Mihon-style source browsing to a Kobo e-reader. Heavy work is outsourced to a server stack on a Mac Mini; the Kobo runs a thin web client. The authoritative design is in **`RFC.md`** (root).

## Repo layout

```
KoManga/
├── RFC.md              # shared design — the "what" (spans all epics)
├── docker-compose.yml  # orchestrates suwayomi + api + cloudflared
├── docs/
│   ├── device.md       # Kobo browser capability report — feeds the API + web-client epics
│   └── koreader.md     # KOReader capability/dev-loop report — feeds the koreader-plugin epic
├── api/                # API epic  (Node/TS server)
│   ├── CLAUDE.md       # ← read this when working in api/
│   └── TASKS.md        # API-NNN tickets
├── web-client/         # Kobo web client epic (Nickel browser)
│   ├── CLAUDE.md       # ← read this when working in web-client/
│   └── TASKS.md        # KWC-NNN tickets
└── koreader-plugin/    # KOReader plugin client epic (full-panel, no browser chrome)
    ├── CLAUDE.md       # ← read this when working in koreader-plugin/
    └── TASKS.md        # KRP-NNN tickets
```

## Which conventions apply

| If you are working in… | Read these | Stack |
|---|---|---|
| `api/` | `api/CLAUDE.md` + `RFC.md` | Express, TS, graphql-request, sharp, better-sqlite3, Vitest |
| `web-client/` | `web-client/CLAUDE.md` + `RFC.md` | Vanilla TS/JS, build-to-old-WebKit, served same-origin by the API |
| `koreader-plugin/` | `koreader-plugin/CLAUDE.md` + `RFC.md` | Lua (LuaJIT), KOReader widget framework, busted, luacheck; no build step |

**Do not mix conventions across epics.** The API rules (layered services, ports/adapters, Express) do not apply to the clients; the web-client rules (no framework, old-WebKit build) do not apply to the API or the KOReader plugin; the plugin's Lua/KOReader rules apply to neither other epic. Each subproject's `CLAUDE.md` is self-contained for its epic.

The two client epics (`web-client/`, `koreader-plugin/`) are **independent clients of the same API**, not shared code — the web client runs in the Kobo's Nickel browser; the KOReader plugin runs inside KOReader using the full panel (it exists because Nickel's chrome/viewport can't be escaped from a web page — see `koreader-plugin/TASKS.md`).

## Cross-cutting rules (all epics)

- **`RFC.md` is the source of truth for design.** If code and RFC disagree, stop and reconcile — don't silently diverge.
- **Strict dependency order.** A ticket cannot start until everything in its `Blocked by` is Done. Follow the *suggested build order* at the bottom of each `TASKS.md`, not strict numeric order.
- **TDD discipline.** `[TEST]` tickets come before their implementation ticket and must fail first. Do the test ticket, review, *then* the impl ticket — never both in one go.
- **One ticket per commit**, message prefixed with the ticket ID (e.g. `API-101: initialise TypeScript Node project`). Mark tickets Done in the relevant `TASKS.md` as you finish them.
- **`docs/device.md` is shared.** The device spike (web-client epic) writes it; the API's `eink` image profile resolution reads from it. Keep them in sync.
- **`docs/koreader.md` is the KOReader-plugin spike doc.** The plugin epic's spike (KRP-101/102) writes it (KOReader version, install/launch, emulator loop); plugin tickets read from it. It shares the same `eink` profile contract as `device.md` — both clients render the API's `eink` output.
- **Suwayomi is never exposed publicly** — internal Docker network only; clients only ever see the API's REST surface.

## Working a ticket — quick procedure

1. `cd` into the right subproject so the correct `CLAUDE.md` is in context.
2. Read that subproject's `CLAUDE.md` and the ticket in its `TASKS.md`.
3. Confirm the ticket's `Blocked by` dependencies are all Done.
4. Implement to satisfy the ticket's acceptance criteria, honouring the subproject conventions.
5. For `[TEST]` tickets: write failing tests against the contract and stop. For impl tickets: make the paired tests pass.
6. Lint/format/type-check clean; commit with the ticket ID; mark it Done.

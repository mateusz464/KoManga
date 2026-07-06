# CLAUDE.md — KoManga (monorepo root)

> This is a **monorepo router**. The detailed conventions live in each subproject. Read the `CLAUDE.md` inside the folder you are working in before doing any work.

---

## What KoManga is

A self-hosted manga reading system that brings Tachiyomi/Mihon-style source browsing to a Kobo e-reader. Heavy work is outsourced to a server stack on a Mac Mini; the Kobo reads through a KOReader plugin client. The authoritative design is in **`RFC.md`** (root).

## Repo layout

```
KoManga/
├── RFC.md              # shared design — the "what" (spans all epics)
├── docker-compose.yml  # orchestrates suwayomi + api + cloudflared
├── docs/
│   ├── device.md       # Kobo panel/rendering capability report — feeds the API eink profile + the koreader-plugin epic
│   └── koreader.md     # KOReader capability/dev-loop report — feeds the koreader-plugin epic
├── api/                # API epic  (Node/TS server)
│   ├── CLAUDE.md       # ← read this when working in api/
│   └── TASKS.md        # API-NNN tickets
└── koreader-plugin/    # KOReader plugin client epic (full-panel, no browser chrome)
    ├── CLAUDE.md       # ← read this when working in koreader-plugin/
    └── TASKS.md        # KRP-NNN tickets
```

> **Discontinued:** a Kobo **web client** epic (`web-client/`, Nickel browser, `KWC-NNN`) previously existed but was **retired** (API-807, 2026-07-06) — its device spike found Nickel's chrome and 732×762 viewport can't be escaped from a web page, so the KOReader plugin is now the sole Kobo client. The `web-client/` directory is gone; only its shared output `docs/device.md` survives (the API `eink` profile and the plugin still depend on it).

## Which conventions apply

| If you are working in… | Read these | Stack |
|---|---|---|
| `api/` | `api/CLAUDE.md` + `RFC.md` | Express, TS, graphql-request, sharp, better-sqlite3, Vitest |
| `koreader-plugin/` | `koreader-plugin/CLAUDE.md` + `RFC.md` | Lua (LuaJIT), KOReader widget framework, busted, luacheck; no build step |

**Do not mix conventions across epics.** The API rules (layered services, ports/adapters, Express) do not apply to the client; the plugin's Lua/KOReader rules do not apply to the API. Each subproject's `CLAUDE.md` is self-contained for its epic.

The KOReader plugin (`koreader-plugin/`) is a **client of the API**: it runs inside KOReader using the full panel (it exists because Nickel's chrome/viewport can't be escaped from a web page, which retired the earlier web client — see `koreader-plugin/TASKS.md`).

## Cross-cutting rules (all epics)

- **`RFC.md` is the source of truth for design.** If code and RFC disagree, stop and reconcile — don't silently diverge.
- **Strict dependency order.** A ticket cannot start until everything in its `Blocked by` is Done. Follow the *suggested build order* at the bottom of each `TASKS.md`, not strict numeric order.
- **TDD discipline.** `[TEST]` tickets come before their implementation ticket and must fail first. Do the test ticket, review, *then* the impl ticket — never both in one go.
- **One ticket per commit**, message prefixed with the ticket ID (e.g. `API-101: initialise TypeScript Node project`). Mark tickets Done in the relevant `TASKS.md` as you finish them.
- **`docs/device.md` is shared.** It was written by the (now-retired) web-client device spike, but it lives on as the Kobo panel capability record: the API's `eink` image profile resolution and the KOReader plugin both read from it. Keep them in sync.
- **`docs/koreader.md` is the KOReader-plugin spike doc.** The plugin epic's spike (KRP-101/102) writes it (KOReader version, install/launch, emulator loop); plugin tickets read from it. It shares the same `eink` profile contract as `device.md` — both clients render the API's `eink` output.
- **Suwayomi is never exposed publicly** — internal Docker network only; clients only ever see the API's REST surface.

## Working a ticket — quick procedure

1. `cd` into the right subproject so the correct `CLAUDE.md` is in context.
2. Read that subproject's `CLAUDE.md` and the ticket in its `TASKS.md`.
3. Confirm the ticket's `Blocked by` dependencies are all Done.
4. Implement to satisfy the ticket's acceptance criteria, honouring the subproject conventions.
5. For `[TEST]` tickets: write failing tests against the contract and stop. For impl tickets: make the paired tests pass.
6. Lint/format/type-check clean; commit with the ticket ID; mark it Done.

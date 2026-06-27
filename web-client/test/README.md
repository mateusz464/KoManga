# Testing client logic (KWC-203)

How to unit-test this client's **logic** off-device. The e-ink panel is the
truth for anything visual — those are `[DEVICE]` tickets, validated on the real
Kobo and never asserted here (CLAUDE.md §4).

## Runner

- **Vitest**, configured in `vitest.config.ts`.
  - `npm test` — single run (CI / Definition-of-Done gate).
  - `npm run test:watch` — watch mode while developing.
- Tests live in `test/`, **mirroring `src/`** (`test/api/foo.test.ts` covers
  `src/api/foo.ts`). Files are named `*.test.ts`.
- `environment: "jsdom"` gives DOM-touching code (and `XMLHttpRequest`) a
  browser-shaped sandbox so modules run without a real browser.
- `globals: true` is on, but tests still **import `describe`/`it`/`expect`/`vi`
  from `"vitest"`** explicitly — that keeps type-check and lint clean (matches
  the API epic's house style).

## What to test here

Logic only: the API client, reading/navigation state, the router, pagination,
prefetch decisions, progress debouncing, URL/query-string building. Pure
`state/` functions are the easiest — no DOM, just inputs → outputs.

Do **not** assert pixels, ghosting, refresh behaviour, fonts, or tap-target
feel. Those don't survive a desktop runner; they're on-device checks.

## Pattern: mock the network at the `api/` boundary

All network access goes through `src/api/` (CLAUDE.md §5). So views and state
are tested by **injecting a stubbed transport/client**, never by hitting a real
server. Prefer passing the dependency in; fall back to `vi.mock` for module
imports.

```ts
import { describe, expect, it, vi } from "vitest";

it("resumes from the synced position", () => {
  const api = { getProgress: vi.fn().mockResolvedValue({ page: 12 }) };
  const state = openManga(api, 42); // module under test takes the client
  // ...assert state shaped the request and mapped the response
  expect(api.getProgress).toHaveBeenCalledWith(42);
});
```

This keeps the transport choice (XHR) and auth-header injection in one place and
makes everything downstream mockable. When KWC-301 tests the API client itself,
mock at the `XMLHttpRequest` layer instead (the boundary moves down one level
for that module only).

## Pattern: DOM-touching logic

When a unit genuinely needs the DOM, jsdom supplies `document`/`window`. Build
nodes, exercise the unit, assert structure/text — not appearance. See
`test/smoke.test.ts` for a minimal example.

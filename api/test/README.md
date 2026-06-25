# Tests

Test runner: **Vitest**. HTTP-level helper: **supertest**.

- Test files live under `test/`, mirroring `src/` (CLAUDE.md §3), and are named `*.test.ts`.
- Run the whole suite with `npm test`; watch mode with `npm run test:watch`.

## Writing HTTP endpoint tests (the documented pattern)

Endpoint tests exercise the Express app **through HTTP** without binding a port.
The composition root exposes an app factory, `createApp(deps)`, in
`src/http/app.ts`. It takes the external ports (e.g. the `SuwayomiClient`) as
injected dependencies, so tests pass mocks at the port boundary. supertest
accepts the returned Express instance directly and issues in-process requests
against it.

The pattern, per CLAUDE.md §4 (endpoint tests go through Express with
services/ports mocked, asserting status codes and the response envelope):

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

describe("GET /some/route", () => {
  it("returns the expected status and body", async () => {
    // Build the app with mocked ports injected so the route is tested in
    // isolation. stubSuwayomi() is a no-op client for routes that don't touch
    // it; pass a controllable mock when the route does.
    const app = createApp({ suwayomi: stubSuwayomi() });

    const res = await request(app).get("/some/route");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
```

Notes:

- Import application modules with the `.js` extension — the project is ESM
  (`"type": "module"`, TS `Node16` resolution), so source imports keep the
  compiled extension.
- Mock at the **port boundary**, not deeper. Inject mocked adapters/services
  via `createApp()` rather than reaching into globals.
- Assert the **response envelope and status code** (CLAUDE.md §6), not internal
  implementation details.

See `test/http/health.test.ts` for a working reference.

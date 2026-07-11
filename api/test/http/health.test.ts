import { describe, expect, it } from "vitest";
import { request } from "../support/http.js";
import { createApp } from "../../src/http/app.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

// Reference HTTP endpoint test (see test/README.md for the pattern): the shared
// helper dispatches each request to this createApp() Express instance.
describe("GET /health", () => {
  it("returns 200 with a JSON status body", async () => {
    const app = createApp({ suwayomi: stubSuwayomi() });

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

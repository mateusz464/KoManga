import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";

// Reference HTTP endpoint test (see test/README.md for the pattern).
// The app factory `createApp()` returns an Express instance that supertest
// drives directly — no real network socket, no running server needed.
describe("GET /health", () => {
  it("returns 200 with a JSON status body", async () => {
    const app = createApp();

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

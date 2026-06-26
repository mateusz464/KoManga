import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

// The 404 fallback must be wired into the real app, not just available in
// isolation: any unmatched route returns the standard error envelope rather than
// Express's default HTML 404.
describe("unmatched routes on the API", () => {
  it("fall through to the standard 404 envelope", async () => {
    const res = await request(createApp({ suwayomi: stubSuwayomi() })).get(
      "/api/definitely-not-a-route",
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: expect.any(String) },
    });
  });
});

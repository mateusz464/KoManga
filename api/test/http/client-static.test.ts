import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { stubSuwayomi } from "../support/stub-suwayomi.js";

// KWC-202: the API serves the built web client same-origin so the client can
// call /api/* with no CORS, while /health and /api/* keep their behaviour.
describe("serving the web client (clientDir)", () => {
  let clientDir: string;

  beforeAll(() => {
    clientDir = mkdtempSync(join(tmpdir(), "komanga-client-"));
    writeFileSync(
      join(clientDir, "index.html"),
      "<!doctype html><title>KoManga</title>",
    );
    writeFileSync(join(clientDir, "main.js"), "console.log('client');");
  });

  afterAll(() => {
    rmSync(clientDir, { recursive: true, force: true });
  });

  it("serves index.html at the root", async () => {
    const res = await request(createApp({ suwayomi: stubSuwayomi(), clientDir }))
      .get("/")
      .expect(200);

    expect(res.text).toContain("KoManga");
    expect(res.type).toBe("text/html");
  });

  it("serves static client assets", async () => {
    const res = await request(createApp({ suwayomi: stubSuwayomi(), clientDir }))
      .get("/main.js")
      .expect(200);

    expect(res.text).toContain("client");
  });

  it("leaves /health unchanged", async () => {
    const res = await request(
      createApp({ suwayomi: stubSuwayomi(), clientDir }),
    ).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("does not let the static mount shadow the /api 404 envelope", async () => {
    const res = await request(
      createApp({ suwayomi: stubSuwayomi(), clientDir }),
    ).get("/api/definitely-not-a-route");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: expect.any(String) },
    });
  });

  it("falls through to the JSON 404 when no clientDir is configured", async () => {
    const res = await request(createApp({ suwayomi: stubSuwayomi() })).get("/");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: expect.any(String) },
    });
  });
});

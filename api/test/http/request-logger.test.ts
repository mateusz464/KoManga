import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import express from "express";
import request from "supertest";
import { createRequestLogger } from "../../src/http/request-logger.js";

function collectingStream(): { stream: Writable; text: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString("utf8") };
}

// pino-http logs on response completion; give the finish handler a tick to run.
const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe("createRequestLogger", () => {
  it("writes one structured request line (method, path, status) without the secret", async () => {
    const token = "req-log-secret-token";
    const { stream, text } = collectingStream();

    const app = express();
    app.use(createRequestLogger({ level: "info", authToken: token, stream }));
    app.get("/ping", (_req, res) => {
      res.json({ ok: true });
    });

    await request(app).get("/ping").set("authorization", `Bearer ${token}`);
    await flush();

    const lines = text()
      .split("\n")
      .filter((line) => line.trim() !== "");
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const entry = JSON.parse(lines[0]) as {
      req: { method: string; url: string };
      res: { statusCode: number };
    };
    expect(entry.req.method).toBe("GET");
    expect(entry.req.url).toBe("/ping");
    expect(entry.res.statusCode).toBe(200);

    // The Authorization header and the token value never appear.
    expect(text()).not.toContain(token);
  });
});

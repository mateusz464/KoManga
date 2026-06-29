import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createErrorHandler } from "../../src/http/error-handler.js";
import { BadRequestError } from "../../src/http/errors.js";
import type { Logger } from "../../src/services/ports/logger.js";

// A mock at the port boundary (CLAUDE.md §4) — the error handler depends on the
// Logger interface, never on pino.
function fakeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// Throwaway app whose only route throws `err`, with the logger-aware error
// handler mounted last (mirrors error-handler.test.ts).
function appThrowing(err: unknown, logger: Logger): express.Express {
  const app = express();
  app.get("/boom", () => {
    throw err;
  });
  app.use(createErrorHandler(logger));
  return app;
}

describe("createErrorHandler", () => {
  it("logs an unexpected error through the port at error level, still returning a safe 500", async () => {
    const logger = fakeLogger();
    const secret = "connection failed: postgres://user:hunter2@db";

    const res = await request(appThrowing(new Error(secret), logger)).get(
      "/boom",
    );

    // The unexpected error is logged server-side via the injected Logger...
    expect(logger.error).toHaveBeenCalledTimes(1);
    // ...while the client still gets the existing safe envelope with no leak.
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "INTERNAL", message: "Internal Server Error" },
    });
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain("hunter2");
    expect(serialised).not.toMatch(/\bat\s+\S+\s+\(/);
  });

  it("maps a handled ApiError as before, without logging it at error level", async () => {
    const logger = fakeLogger();

    const res = await request(
      appThrowing(new BadRequestError("bad input"), logger),
    ).get("/boom");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "BAD_REQUEST", message: "bad input" },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler, notFoundHandler } from "../../src/http/error-handler.js";
import {
  ApiError,
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
} from "../../src/http/errors.js";

// Build a throwaway app whose only route throws `err`, with the centralised
// error handler mounted last. Express forwards the throw to the error handler,
// exactly as the real app will.
function appThrowing(err: unknown): express.Express {
  const app = express();
  app.get("/boom", () => {
    throw err;
  });
  app.use(errorHandler);
  return app;
}

describe("errorHandler", () => {
  const cases: ReadonlyArray<{
    name: string;
    err: ApiError;
    status: number;
    code: string;
    message: string;
  }> = [
    {
      name: "BadRequestError",
      err: new BadRequestError("bad input"),
      status: 400,
      code: "BAD_REQUEST",
      message: "bad input",
    },
    {
      name: "UnauthorizedError",
      err: new UnauthorizedError("missing credential"),
      status: 401,
      code: "UNAUTHORIZED",
      message: "missing credential",
    },
    {
      name: "NotFoundError",
      err: new NotFoundError("no such resource"),
      status: 404,
      code: "NOT_FOUND",
      message: "no such resource",
    },
  ];

  it.each(cases)(
    "maps $name to its status + the standard envelope",
    async ({ err, status, code, message }) => {
      const res = await request(appThrowing(err)).get("/boom");

      expect(res.status).toBe(status);
      expect(res.body).toEqual({ error: { code, message } });
    },
  );

  it("maps an unknown error to a generic 500 without leaking details", async () => {
    const secret = "connection failed: postgres://user:hunter2@db";
    const res = await request(appThrowing(new Error(secret))).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "INTERNAL", message: "Internal Server Error" },
    });
    // No internal message and no stack frames cross the boundary (CLAUDE.md §6).
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain("hunter2");
    expect(serialised).not.toMatch(/\bat\s+\S+\s+\(/);
  });
});

describe("notFoundHandler", () => {
  it("responds 404 with the error envelope for an unmatched route", async () => {
    const app = express();
    app.use(notFoundHandler);

    const res = await request(app).get("/no/such/path");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: expect.any(String) },
    });
    expect(res.body.error.message.length).toBeGreaterThan(0);
  });
});

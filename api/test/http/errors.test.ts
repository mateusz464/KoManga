import { describe, expect, it } from "vitest";
import {
  ApiError,
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
} from "../../src/http/errors.js";

// Contract: every typed domain error carries the HTTP `status` and stable
// machine-readable `code` that the error middleware reads when shaping the
// response envelope (CLAUDE.md §6). The thrown message is the safe, client-facing
// message for 4xx errors.
describe("typed API errors", () => {
  it("BadRequestError → 400 / BAD_REQUEST", () => {
    const err = new BadRequestError("missing q");
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(400);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("missing q");
  });

  it("UnauthorizedError → 401 / UNAUTHORIZED", () => {
    const err = new UnauthorizedError("no token");
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.message).toBe("no token");
  });

  it("NotFoundError → 404 / NOT_FOUND", () => {
    const err = new NotFoundError("unknown manga");
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("unknown manga");
  });
});

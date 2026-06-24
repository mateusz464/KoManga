// Typed domain errors (CLAUDE.md §6). Services throw these; the error
// middleware (error-handler.ts) is the single place that maps them to an HTTP
// status + the standard error envelope.
//
// STUB for API-104: the type surface (the contract the tests pin down) is here,
// but the per-error status/code are intentionally not wired yet. API-105 gives
// each subclass its real status + code to make the API-104 tests pass.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = "INTERNAL") {
    super(message);
    this.status = status;
    this.code = code;
    this.name = new.target.name;
  }
}

export class BadRequestError extends ApiError {}

export class UnauthorizedError extends ApiError {}

export class NotFoundError extends ApiError {}

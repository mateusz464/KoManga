// Typed domain errors (CLAUDE.md §6). Services throw these; the error
// middleware (error-handler.ts) is the single place that maps them to an HTTP
// status + the standard error envelope.

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

export class BadRequestError extends ApiError {
  constructor(message: string) {
    super(message, 400, "BAD_REQUEST");
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message: string) {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string) {
    super(message, 404, "NOT_FOUND");
  }
}

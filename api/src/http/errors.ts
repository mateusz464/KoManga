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

export class RateLimitedError extends ApiError {
  constructor(message: string) {
    super(message, 429, "RATE_LIMITED");
  }
}

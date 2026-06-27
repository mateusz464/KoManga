import type { ErrorRequestHandler, RequestHandler } from "express";
import { ApiError } from "./errors.js";

interface ErrorBody {
  error: { code: string; message: string };
}

function envelope(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json(envelope(err.code, err.message));
    return;
  }

  // Log unexpected errors server-side; return a safe 500 that leaks nothing.
  console.error(err);
  res.status(500).json(envelope("INTERNAL", "Internal Server Error"));
};

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(envelope("NOT_FOUND", "Resource not found"));
};

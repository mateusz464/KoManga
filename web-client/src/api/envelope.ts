import { ApiClientError, UnauthorizedError } from "./errors.js";

export function unwrap<T>(text: string): T {
  const parsed = JSON.parse(text) as { data: T };
  return parsed.data;
}

export function mapError(status: number, text: string): ApiClientError {
  let code = "UNKNOWN";
  let message = "Request failed with status " + status;
  try {
    const parsed = JSON.parse(text) as {
      error?: { code?: string; message?: string };
    };
    if (parsed && parsed.error) {
      if (parsed.error.code) code = parsed.error.code;
      if (parsed.error.message) message = parsed.error.message;
    }
  } catch {
    // Non-JSON error body (e.g. an HTML 500 page): map by status alone.
  }
  if (status === 401) return new UnauthorizedError(message);
  return new ApiClientError(message, status, code);
}

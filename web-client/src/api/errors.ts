// Typed errors the API client rejects with, so callers (views/state) can branch
// without parsing strings (CLAUDE.md §9 — explicit, user-visible error states).
// Every non-2xx response and transport failure is normalised to one of these.

export class ApiClientError extends Error {
  // HTTP status (0 for a transport-level failure with no response).
  readonly status: number;
  // The API envelope's error code (`{ error: { code, message } }`), or a
  // synthesised code (e.g. "NETWORK") when the body carried none.
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
  }
}

// 401 from any call. Singled out because the auth flow (KWC-303/304) routes back
// to the credential prompt on this specific error.
export class UnauthorizedError extends ApiClientError {
  constructor(message = "Missing or invalid credentials") {
    super(message, 401, "UNAUTHORIZED");
  }
}

// The request never produced an HTTP response (offline, DNS, tunnel down, abort).
// Distinct from a 5xx so the UI can offer a plain retry (RFC §6 — never a blank
// panel).
export class NetworkError extends ApiClientError {
  constructor(message = "Network request failed") {
    super(message, 0, "NETWORK");
  }
}

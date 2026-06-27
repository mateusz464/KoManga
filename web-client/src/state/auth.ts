// KWC-303/304 — single-user credential auth flow (CLAUDE.md §6, RFC §6).
//
// One credential for the whole client: entered once, persisted, attached to
// every `/api/*` request (via the ApiClient's `getToken` callback), and dropped
// on a 401 so the shell can route back to the credential prompt.
//
// Storage is localStorage — the only persistence the spike confirmed on-device
// (KWC-102). It's injectable here so logic is testable off-device without
// touching the real panel; the default is the browser's localStorage.

import { UnauthorizedError } from "../api/errors.js";

// localStorage key the credential is stored under. Namespaced so it never
// collides with anything else the app keeps in the same origin's storage.
export const CREDENTIAL_STORAGE_KEY = "komanga.credential";

// The slice of the Web Storage API this flow needs. localStorage satisfies it;
// tests inject an in-memory double to assert persistence deterministically.
export interface CredentialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AuthControllerOptions {
  // Defaults to the browser's localStorage when omitted.
  readonly storage?: CredentialStorage;
  // Fired when the credential is missing/rejected (a 401), so the shell can
  // route back to the credential entry view. Wired by KWC-307.
  readonly onRequireLogin?: () => void;
}

export class AuthController {
  private readonly storage: CredentialStorage;
  private readonly onRequireLogin?: () => void;

  constructor(options: AuthControllerOptions = {}) {
    this.storage = options.storage ?? localStorage;
    this.onRequireLogin = options.onRequireLogin;
  }

  // The callback handed to `new ApiClient({ getToken })`: the stored credential,
  // or null when none is set. Read per request so a fresh login is picked up.
  getToken(): string | null {
    return this.storage.getItem(CREDENTIAL_STORAGE_KEY);
  }

  isAuthenticated(): boolean {
    return this.getToken() !== null;
  }

  // Persist the entered credential so it survives a reload.
  login(token: string): void {
    this.storage.setItem(CREDENTIAL_STORAGE_KEY, token);
  }

  // Forget the credential (sign out, or after a rejected one).
  logout(): void {
    this.storage.removeItem(CREDENTIAL_STORAGE_KEY);
  }

  // Inspect a rejected ApiClient error. On an UnauthorizedError (401) clear the
  // stored credential and fire `onRequireLogin`, returning true so the caller
  // knows the auth flow handled it. Any other error returns false untouched —
  // a non-401 ApiClientError or a transport NetworkError (offline ≠ unauthorised).
  handleApiError(error: unknown): boolean {
    if (!(error instanceof UnauthorizedError)) return false;
    this.logout();
    if (this.onRequireLogin) this.onRequireLogin();
    return true;
  }
}

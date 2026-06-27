import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthController,
  CREDENTIAL_STORAGE_KEY,
  type CredentialStorage,
} from "../../src/state/auth.js";
import { ApiClient } from "../../src/api/client.js";
import {
  ApiClientError,
  NetworkError,
  UnauthorizedError,
} from "../../src/api/errors.js";

// KWC-303 — contract tests for the single-credential auth flow.
//
// The flow has two jobs (acceptance criteria):
//   1. Persist the credential so it survives a reload, using the storage the
//      spike confirmed on-device — localStorage (KWC-102).
//   2. On a 401 from ANY API call, drop the credential and route back to the
//      credential entry view (via the onRequireLogin callback the shell wires).
//
// Storage is mocked at the CredentialStorage boundary so persistence is asserted
// deterministically (an in-memory double standing in for localStorage); one test
// also checks the real default is the browser's localStorage. The API client is
// mocked at the XMLHttpRequest layer (per test/README.md) only for the one
// end-to-end 401 test — everything else feeds errors to handleApiError directly.
//
// Red phase: the KWC-303 stub throws "not implemented", so these fail until the
// KWC-304 implementation lands.

// In-memory CredentialStorage double. Surviving across two AuthController
// instances over the same instance simulates a page reload.
function memoryStorage(
  initial: Record<string, string> = {},
): CredentialStorage {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = value;
    },
    removeItem: (key) => {
      delete store[key];
    },
  };
}

describe("AuthController — credential persistence", () => {
  it("starts unauthenticated with no token when storage is empty", () => {
    const auth = new AuthController({ storage: memoryStorage() });

    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.getToken()).toBeNull();
  });

  it("login() makes the credential available as the token", () => {
    const auth = new AuthController({ storage: memoryStorage() });

    auth.login("secret-token");

    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.getToken()).toBe("secret-token");
  });

  it("writes the credential under the namespaced storage key", () => {
    const storage = memoryStorage();
    const auth = new AuthController({ storage });

    auth.login("secret-token");

    expect(storage.getItem(CREDENTIAL_STORAGE_KEY)).toBe("secret-token");
  });

  it("persists the credential across reloads (a fresh controller reads it back)", () => {
    const storage = memoryStorage();
    new AuthController({ storage }).login("persisted-token");

    // Simulate a reload: brand-new controller over the same storage.
    const reloaded = new AuthController({ storage });

    expect(reloaded.isAuthenticated()).toBe(true);
    expect(reloaded.getToken()).toBe("persisted-token");
  });

  it("reads an already-stored credential present at construction", () => {
    const storage = memoryStorage({
      [CREDENTIAL_STORAGE_KEY]: "pre-existing",
    });

    const auth = new AuthController({ storage });

    expect(auth.getToken()).toBe("pre-existing");
  });

  it("logout() clears the credential from storage", () => {
    const storage = memoryStorage();
    const auth = new AuthController({ storage });
    auth.login("secret-token");

    auth.logout();

    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.getToken()).toBeNull();
    expect(storage.getItem(CREDENTIAL_STORAGE_KEY)).toBeNull();
  });

  it("defaults to the browser's localStorage when no storage is injected", () => {
    localStorage.removeItem(CREDENTIAL_STORAGE_KEY);

    new AuthController().login("ls-token");

    // Persisted to the real localStorage, and a fresh controller reads it back.
    expect(localStorage.getItem(CREDENTIAL_STORAGE_KEY)).toBe("ls-token");
    expect(new AuthController().getToken()).toBe("ls-token");
  });
});

describe("AuthController — getToken for the ApiClient", () => {
  it("supplies a getToken callback the ApiClient can read per request", () => {
    const auth = new AuthController({ storage: memoryStorage() });

    // The shell wires `new ApiClient({ getToken: () => auth.getToken() })`.
    const getToken = () => auth.getToken();

    expect(getToken()).toBeNull();
    auth.login("late-login");
    expect(getToken()).toBe("late-login"); // picked up without rebuilding anything
  });
});

describe("AuthController — 401 routes back to the credential prompt", () => {
  it("clears the credential and fires onRequireLogin on an UnauthorizedError", () => {
    const onRequireLogin = vi.fn();
    const storage = memoryStorage();
    const auth = new AuthController({ storage, onRequireLogin });
    auth.login("stale-token");

    const handled = auth.handleApiError(new UnauthorizedError());

    expect(handled).toBe(true);
    expect(onRequireLogin).toHaveBeenCalledTimes(1);
    expect(auth.isAuthenticated()).toBe(false);
    expect(storage.getItem(CREDENTIAL_STORAGE_KEY)).toBeNull();
  });

  it("leaves the credential intact for a non-401 ApiClientError", () => {
    const onRequireLogin = vi.fn();
    const auth = new AuthController({
      storage: memoryStorage(),
      onRequireLogin,
    });
    auth.login("good-token");

    const handled = auth.handleApiError(
      new ApiClientError("Upstream failed", 502, "SUWAYOMI_ERROR"),
    );

    expect(handled).toBe(false);
    expect(onRequireLogin).not.toHaveBeenCalled();
    expect(auth.getToken()).toBe("good-token");
  });

  it("does not sign out on a transport NetworkError (offline is not unauthorised)", () => {
    const onRequireLogin = vi.fn();
    const auth = new AuthController({
      storage: memoryStorage(),
      onRequireLogin,
    });
    auth.login("good-token");

    const handled = auth.handleApiError(new NetworkError());

    expect(handled).toBe(false);
    expect(onRequireLogin).not.toHaveBeenCalled();
    expect(auth.getToken()).toBe("good-token");
  });

  it("ignores a non-error value without throwing", () => {
    const onRequireLogin = vi.fn();
    const auth = new AuthController({
      storage: memoryStorage(),
      onRequireLogin,
    });

    expect(auth.handleApiError("not an error")).toBe(false);
    expect(onRequireLogin).not.toHaveBeenCalled();
  });
});

// End-to-end: a real 401 from the ApiClient (the actual UnauthorizedError the
// transport produces) drives the auth flow back to the prompt — proving the
// "from ANY call" criterion against the real error, not a hand-built one.
describe("AuthController — wired to a real ApiClient 401", () => {
  class FakeXhr {
    status = 0;
    responseText = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    open(): void {}
    setRequestHeader(): void {}
    send(): void {
      void Promise.resolve().then(() => {
        this.status = 401;
        this.responseText = JSON.stringify({
          error: {
            code: "UNAUTHORIZED",
            message: "Missing or invalid credentials",
          },
        });
        if (this.onload) this.onload();
      });
    }
  }

  const ORIGINAL_XHR = globalThis.XMLHttpRequest;
  beforeEach(() => {
    (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
  });
  afterEach(() => {
    (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = ORIGINAL_XHR;
  });

  it("a 401 from any endpoint routes back to the credential entry view", async () => {
    const onRequireLogin = vi.fn();
    const auth = new AuthController({
      storage: memoryStorage(),
      onRequireLogin,
    });
    auth.login("expired-token");
    const api = new ApiClient({ getToken: () => auth.getToken() });

    const error = await api.listSources().then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(auth.handleApiError(error)).toBe(true);
    expect(onRequireLogin).toHaveBeenCalledTimes(1);
    expect(auth.isAuthenticated()).toBe(false);
  });
});

// KWC-305/306 — minimal, framework-free view router (CLAUDE.md §5).
//
// Switches between the four views (routes.ts) without a framework and without a
// full page reload: navigation only mutates the URL fragment (the hash). The
// fragment is the single source of truth — navigate() pushes a new hash, the
// browser's hashchange (or back/forward) is what actually updates the current
// route and notifies listeners. This keeps programmatic navigation and physical
// back/forward on one path, and means "back navigation" is just the browser's
// own history stack.
//
// The window/history/hashchange surface is injected as a RouterEnvironment so the
// logic is testable off-device with a deterministic fake (mirrors how auth.ts
// injects CredentialStorage). The default wraps the real `window`.
//
// Red phase (KWC-305): every method throws until KWC-306 implements them.

import type { Route } from "./routes.js";

// The slice of the browser this router needs. The default implementation wraps
// `window.location` / `window.history` / the `hashchange` event; tests inject a
// fake with a back-stack to assert navigation and back() deterministically.
export interface RouterEnvironment {
  // Current fragment, including the leading "#" (or "" when none).
  getHash(): string;
  // Navigate to a new fragment, adding a history entry (no reload). Mirrors
  // assigning `location.hash`.
  pushHash(hash: string): void;
  // Replace the current fragment in place, adding no history entry. Mirrors
  // `history.replaceState`.
  replaceHash(hash: string): void;
  // Step back one history entry. Mirrors `history.back()`.
  back(): void;
  // Subscribe to fragment changes (programmatic, or physical back/forward).
  // Returns an unsubscribe function.
  subscribe(listener: () => void): () => void;
}

export interface RouterOptions {
  // Defaults to a RouterEnvironment over the real `window` when omitted.
  readonly environment?: RouterEnvironment;
  // Convenience: notified on every route change, including the initial route at
  // start(). The same as subscribe(), wired at construction.
  readonly onChange?: (route: Route) => void;
}

export class Router {
  constructor(_options: RouterOptions = {}) {
    // No-op in the red phase so tests fail on their real assertions, not setup.
  }

  // Begin listening for fragment changes and emit the current route once so the
  // shell can paint the initial view. Idempotent.
  start(): void {
    throw new Error("not implemented yet — see KWC-306");
  }

  // Stop listening (unsubscribe from the environment).
  stop(): void {
    throw new Error("not implemented yet — see KWC-306");
  }

  // The route the current fragment maps to.
  current(): Route {
    throw new Error("not implemented yet — see KWC-306");
  }

  // Navigate to a route, pushing a history entry. No full reload — only the
  // fragment changes; the resulting hashchange updates current() and notifies.
  navigate(_route: Route): void {
    throw new Error("not implemented yet — see KWC-306");
  }

  // Navigate without adding a history entry (replaces the current one).
  replace(_route: Route): void {
    throw new Error("not implemented yet — see KWC-306");
  }

  // Go back to the previous route in history.
  back(): void {
    throw new Error("not implemented yet — see KWC-306");
  }

  // Subscribe to route changes. Returns an unsubscribe function.
  subscribe(_listener: (route: Route) => void): () => void {
    throw new Error("not implemented yet — see KWC-306");
  }
}

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

import { parseHash, routeToHash, type Route } from "./routes.js";

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
  private readonly environment: RouterEnvironment;
  // Plain array, not a Set: this WebKit's native Set is unreliable and the
  // core-js Set polyfill crashes it (CLAUDE.md §12) — string-keyed objects and
  // plain arrays only.
  private readonly subscribers: Array<(route: Route) => void> = [];
  private currentRoute: Route;
  // Unsubscribe from the environment while started; null when stopped.
  private detach: (() => void) | null = null;

  constructor(options: RouterOptions = {}) {
    this.environment = options.environment ?? createWindowEnvironment();
    if (options.onChange) this.subscribers.push(options.onChange);
    // Seed from the current fragment so current() is valid before start().
    this.currentRoute = parseHash(this.environment.getHash());
  }

  // Begin listening for fragment changes and emit the current route once so the
  // shell can paint the initial view. Idempotent.
  start(): void {
    if (this.detach) return;
    this.detach = this.environment.subscribe(() => this.syncFromFragment());
    // Emit the initial route (programmatic + onChange).
    this.syncFromFragment();
  }

  // Stop listening (unsubscribe from the environment).
  stop(): void {
    if (this.detach) {
      this.detach();
      this.detach = null;
    }
  }

  // The route the current fragment maps to.
  current(): Route {
    return this.currentRoute;
  }

  // Navigate to a route, pushing a history entry. No full reload — only the
  // fragment changes; the resulting hashchange updates current() and notifies.
  navigate(route: Route): void {
    this.environment.pushHash(routeToHash(route));
  }

  // Navigate without adding a history entry (replaces the current one). Since
  // replaceHash fires no change event (like history.replaceState), update from
  // the new fragment directly.
  replace(route: Route): void {
    this.environment.replaceHash(routeToHash(route));
    this.syncFromFragment();
  }

  // Go back to the previous route in history.
  back(): void {
    this.environment.back();
  }

  // Subscribe to route changes. Returns an unsubscribe function.
  subscribe(listener: (route: Route) => void): () => void {
    this.subscribers.push(listener);
    const subscribers = this.subscribers;
    return function () {
      const index = subscribers.indexOf(listener);
      if (index >= 0) subscribers.splice(index, 1);
    };
  }

  // Re-read the fragment (the single source of truth), update the current route,
  // and notify every subscriber. Driven both by environment changes (programmatic
  // navigate/back, or a physical back/forward) and directly by replace().
  private syncFromFragment(): void {
    this.currentRoute = parseHash(this.environment.getHash());
    const route = this.currentRoute;
    // Copy first so an unsubscribe during notification is safe.
    const listeners = this.subscribers.slice();
    for (let i = 0; i < listeners.length; i++) listeners[i](route);
  }
}

// Default RouterEnvironment over the real `window`: the URL fragment plus the
// `hashchange` event. Never exercised by the off-device tests (they inject a
// fake), but it is the surface the Kobo actually uses.
function createWindowEnvironment(): RouterEnvironment {
  return {
    getHash: function () {
      return window.location.hash;
    },
    pushHash: function (hash: string) {
      window.location.hash = hash;
    },
    replaceHash: function (hash: string) {
      const base = window.location.pathname + window.location.search;
      window.history.replaceState(null, "", base + hash);
    },
    back: function () {
      window.history.back();
    },
    subscribe: function (listener: () => void) {
      window.addEventListener("hashchange", listener);
      return function () {
        window.removeEventListener("hashchange", listener);
      };
    },
  };
}

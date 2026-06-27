import { describe, expect, it, vi } from "vitest";
import { parseHash, routeToHash, type Route } from "../../src/router/routes.js";
import { Router, type RouterEnvironment } from "../../src/router/router.js";

// KWC-305 — contract tests for the minimal, framework-free view router.
//
// Two acceptance criteria:
//   1. Navigating between the four views (library, search, manga details,
//      reader) updates state correctly, and back navigation works.
//   2. No full reloads between views — navigation only mutates the URL fragment
//      (the hash), which browsers do not reload on.
//
// The router is split like api/ is: routes.ts holds the pure fragment <-> Route
// serialization (no URL/URLSearchParams — KWC-102 — so it is hand-rolled and
// directly unit-testable), and router.ts holds the stateful piece, which takes
// the window/history/hashchange surface as an injected RouterEnvironment. Tests
// drive a deterministic in-memory environment with a real back-stack, the same
// dependency-injection trick auth.ts uses for CredentialStorage.
//
// Red phase: the KWC-305 stubs throw "not implemented", so these fail until the
// KWC-306 implementation lands.

// In-memory RouterEnvironment: a history stack with a cursor, standing in for
// window.location/history. pushHash adds an entry and (like a real browser
// assigning location.hash) fires the change listeners; back() moves the cursor
// and fires them; replaceHash overwrites in place WITHOUT firing (mirrors
// history.replaceState, which emits no hashchange).
class FakeEnvironment implements RouterEnvironment {
  private stack: string[];
  private cursor: number;
  private readonly listeners = new Set<() => void>();

  constructor(initial = "") {
    this.stack = [initial];
    this.cursor = 0;
  }

  getHash(): string {
    return this.stack[this.cursor];
  }

  pushHash(hash: string): void {
    // Truncate any forward history, then push and advance — like a browser.
    this.stack = this.stack.slice(0, this.cursor + 1);
    this.stack.push(hash);
    this.cursor = this.stack.length - 1;
    this.emit();
  }

  replaceHash(hash: string): void {
    this.stack[this.cursor] = hash;
    // No emit: history.replaceState does not fire hashchange.
  }

  back(): void {
    if (this.cursor > 0) {
      this.cursor -= 1;
      this.emit();
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  // Test helper: how many history entries exist (to prove replace adds none).
  depth(): number {
    return this.stack.length;
  }
}

describe("routes — fragment serialization (pure)", () => {
  it("serializes each view to a '#'-prefixed fragment (fragment-only = no reload)", () => {
    const cases: Route[] = [
      { name: "library" },
      { name: "search", query: "naruto", source: "mangadex" },
      { name: "manga", mangaId: "abc" },
      { name: "reader", mangaId: "abc", chapterId: "ch1" },
    ];

    for (const route of cases) {
      expect(routeToHash(route).charAt(0)).toBe("#");
    }
  });

  it("serializes the four views to readable fragments", () => {
    expect(routeToHash({ name: "library" })).toBe("#/library");
    expect(routeToHash({ name: "search" })).toBe("#/search");
    expect(routeToHash({ name: "manga", mangaId: "abc" })).toBe("#/manga/abc");
    expect(
      routeToHash({ name: "reader", mangaId: "abc", chapterId: "ch1" }),
    ).toBe("#/reader/abc/ch1");
  });

  it("builds the search query string by hand, omitting absent params", () => {
    expect(
      routeToHash({ name: "search", query: "one piece", source: "mangadex" }),
    ).toBe("#/search?q=one%20piece&source=mangadex");
    // Only a query, no source — source must not appear.
    expect(routeToHash({ name: "search", query: "bleach" })).toBe(
      "#/search?q=bleach",
    );
    // No params at all — bare path.
    expect(routeToHash({ name: "search" })).toBe("#/search");
  });

  it("percent-encodes ids carrying '/' and ':' (Suwayomi-style ids)", () => {
    expect(routeToHash({ name: "manga", mangaId: "src1/manga:42" })).toBe(
      "#/manga/src1%2Fmanga%3A42",
    );
    expect(
      routeToHash({ name: "reader", mangaId: "m1", chapterId: "c:5" }),
    ).toBe("#/reader/m1/c%3A5");
  });

  it("parses each fragment back into the matching route", () => {
    expect(parseHash("#/library")).toEqual({ name: "library" });
    expect(parseHash("#/search?q=one%20piece&source=mangadex")).toEqual({
      name: "search",
      query: "one piece",
      source: "mangadex",
    });
    expect(parseHash("#/manga/src1%2Fmanga%3A42")).toEqual({
      name: "manga",
      mangaId: "src1/manga:42",
    });
    expect(parseHash("#/reader/m1/c%3A5")).toEqual({
      name: "reader",
      mangaId: "m1",
      chapterId: "c:5",
    });
  });

  it("falls back to the library view for an empty or unknown fragment", () => {
    expect(parseHash("")).toEqual({ name: "library" });
    expect(parseHash("#")).toEqual({ name: "library" });
    expect(parseHash("#/")).toEqual({ name: "library" });
    expect(parseHash("#/nonsense")).toEqual({ name: "library" });
  });

  it("round-trips routes through hash and back", () => {
    const routes: Route[] = [
      { name: "library" },
      { name: "search", query: "full metal", source: "src/9" },
      { name: "manga", mangaId: "a/b:c" },
      { name: "reader", mangaId: "a/b", chapterId: "ch:10" },
    ];

    for (const route of routes) {
      expect(parseHash(routeToHash(route))).toEqual(route);
    }
  });
});

describe("Router — initial route", () => {
  it("reports the library view and emits it at start when the fragment is empty", () => {
    const onChange = vi.fn();
    const router = new Router({
      environment: new FakeEnvironment(""),
      onChange,
    });

    router.start();

    expect(router.current()).toEqual({ name: "library" });
    expect(onChange).toHaveBeenCalledWith({ name: "library" });
  });

  it("reads an existing fragment at start", () => {
    const router = new Router({
      environment: new FakeEnvironment("#/manga/abc"),
    });

    router.start();

    expect(router.current()).toEqual({ name: "manga", mangaId: "abc" });
  });
});

describe("Router — navigation updates state without a reload", () => {
  it("navigate() switches the current route and notifies subscribers once", () => {
    const env = new FakeEnvironment("");
    const router = new Router({ environment: env });
    router.start();

    const seen = vi.fn();
    router.subscribe(seen);

    router.navigate({ name: "search", query: "naruto" });

    expect(router.current()).toEqual({ name: "search", query: "naruto" });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith({ name: "search", query: "naruto" });
  });

  it("navigation only mutates the fragment (the hash stays fragment-only)", () => {
    const env = new FakeEnvironment("");
    const router = new Router({ environment: env });
    router.start();

    router.navigate({ name: "reader", mangaId: "m1", chapterId: "c1" });

    expect(env.getHash().charAt(0)).toBe("#");
    expect(env.getHash()).toBe("#/reader/m1/c1");
  });

  it("moves correctly across all four views in sequence", () => {
    const router = new Router({ environment: new FakeEnvironment("") });
    router.start();

    router.navigate({ name: "search", query: "bleach", source: "mangadex" });
    expect(router.current()).toEqual({
      name: "search",
      query: "bleach",
      source: "mangadex",
    });

    router.navigate({ name: "manga", mangaId: "m1" });
    expect(router.current()).toEqual({ name: "manga", mangaId: "m1" });

    router.navigate({ name: "reader", mangaId: "m1", chapterId: "c1" });
    expect(router.current()).toEqual({
      name: "reader",
      mangaId: "m1",
      chapterId: "c1",
    });

    router.navigate({ name: "library" });
    expect(router.current()).toEqual({ name: "library" });
  });
});

describe("Router — back navigation", () => {
  it("back() returns to the previous view", () => {
    const router = new Router({ environment: new FakeEnvironment("") });
    router.start();

    router.navigate({ name: "manga", mangaId: "m1" });
    router.navigate({ name: "reader", mangaId: "m1", chapterId: "c1" });
    expect(router.current()).toEqual({
      name: "reader",
      mangaId: "m1",
      chapterId: "c1",
    });

    router.back();
    expect(router.current()).toEqual({ name: "manga", mangaId: "m1" });

    router.back();
    expect(router.current()).toEqual({ name: "library" });
  });

  it("notifies subscribers when going back", () => {
    const router = new Router({ environment: new FakeEnvironment("") });
    router.start();
    router.navigate({ name: "manga", mangaId: "m1" });

    const seen = vi.fn();
    router.subscribe(seen);
    router.back();

    expect(seen).toHaveBeenCalledWith({ name: "library" });
  });

  it("picks up a physical back/forward (fragment change from outside)", () => {
    // The router must react to the environment's own hash changes, not only to
    // its own navigate() calls — that is how hardware/browser back works.
    const env = new FakeEnvironment("");
    const router = new Router({ environment: env });
    router.start();
    router.navigate({ name: "manga", mangaId: "m1" });

    env.back(); // as if the user pressed Back in the browser chrome

    expect(router.current()).toEqual({ name: "library" });
  });
});

describe("Router — replace adds no history entry", () => {
  it("replace() swaps the view but back() skips the replaced entry", () => {
    const env = new FakeEnvironment("");
    const router = new Router({ environment: env });
    router.start();
    router.navigate({ name: "manga", mangaId: "m1" });

    const depthBefore = env.depth();
    router.replace({ name: "manga", mangaId: "m2" });

    expect(router.current()).toEqual({ name: "manga", mangaId: "m2" });
    expect(env.depth()).toBe(depthBefore); // no new entry
    router.back();
    expect(router.current()).toEqual({ name: "library" });
  });
});

describe("Router — subscription lifecycle", () => {
  it("unsubscribe() stops further notifications", () => {
    const router = new Router({ environment: new FakeEnvironment("") });
    router.start();

    const seen = vi.fn();
    const unsubscribe = router.subscribe(seen);

    router.navigate({ name: "manga", mangaId: "m1" });
    expect(seen).toHaveBeenCalledTimes(1);

    unsubscribe();
    router.navigate({ name: "search", query: "x" });
    expect(seen).toHaveBeenCalledTimes(1); // no further calls
  });

  it("stop() detaches the router from the environment", () => {
    const env = new FakeEnvironment("");
    const router = new Router({ environment: env });
    router.start();

    const seen = vi.fn();
    router.subscribe(seen);
    router.stop();

    env.back(); // an outside fragment change after stop
    expect(seen).not.toHaveBeenCalled();
    env.pushHash("#/manga/zzz");
    expect(seen).not.toHaveBeenCalled();
  });
});

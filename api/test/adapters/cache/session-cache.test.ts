import { describe, expect, it, vi } from "vitest";
import {
  InMemorySessionCache,
  type InMemorySessionCacheOptions,
} from "../../../src/adapters/cache/in-memory-session-cache.js";
import type {
  CachedPage,
  SessionCache,
} from "../../../src/services/ports/session-cache.js";

// Contract test for the SessionCache port (API-405). The cache is in-memory, so
// — per CLAUDE.md §4.4 — the adapter is exercised directly rather than mocked.
// The real behaviour lands in API-406; these behavioural assertions stay red
// until then (the stub throws).
//
// Contract (RFC §5, CLAUDE.md §7):
//   - keyed by page id + profile — raw and eink of one page are distinct entries
//   - per-entry TTL — expired entries are never served
//   - size-bound eviction — total cached bytes stay within the byte budget
//   - exposed behind a mockable interface

/** A processed page of a given byte size — size is what the byte-budget counts. */
function page(sizeBytes: number, contentType = "image/png"): CachedPage {
  return { bytes: Buffer.alloc(sizeBytes), contentType };
}

/** A cache with an injected, manually-advanced clock so TTL is deterministic. */
function cacheWithClock(options: Omit<InMemorySessionCacheOptions, "clock">): {
  cache: InMemorySessionCache;
  advance: (ms: number) => void;
} {
  let now = 0;
  const cache = new InMemorySessionCache({ ...options, clock: () => now });
  return {
    cache,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const ROOMY = { maxBytes: 10_000, ttlMs: 60_000 };

describe("InMemorySessionCache (SessionCache port contract)", () => {
  describe("hit / miss", () => {
    it("returns undefined for a key that was never stored", () => {
      const cache = new InMemorySessionCache(ROOMY);

      expect(cache.get("1:0", "raw")).toBeUndefined();
    });

    it("returns the stored page on a hit", () => {
      const cache = new InMemorySessionCache(ROOMY);
      const stored = page(128, "image/jpeg");

      cache.set("1:0", "raw", stored);
      const got = cache.get("1:0", "raw");

      expect(got?.bytes.equals(stored.bytes)).toBe(true);
      expect(got?.contentType).toBe("image/jpeg");
    });

    it("overwrites the existing entry for the same key", () => {
      const cache = new InMemorySessionCache(ROOMY);

      cache.set("1:0", "raw", page(100, "image/png"));
      cache.set("1:0", "raw", page(200, "image/webp"));
      const got = cache.get("1:0", "raw");

      expect(got?.bytes.length).toBe(200);
      expect(got?.contentType).toBe("image/webp");
    });
  });

  describe("profile-aware keying", () => {
    it("treats raw and eink of the same page as distinct entries", () => {
      const cache = new InMemorySessionCache(ROOMY);
      const raw = page(100, "image/png");
      const eink = page(50, "image/png");

      cache.set("1:0", "raw", raw);
      cache.set("1:0", "eink", eink);

      expect(cache.get("1:0", "raw")?.bytes.length).toBe(100);
      expect(cache.get("1:0", "eink")?.bytes.length).toBe(50);
    });

    it("does not serve one profile for a key cached only under the other", () => {
      const cache = new InMemorySessionCache(ROOMY);

      cache.set("1:0", "raw", page(100));

      expect(cache.get("1:0", "eink")).toBeUndefined();
    });

    it("treats distinct page ids as distinct entries", () => {
      const cache = new InMemorySessionCache(ROOMY);

      cache.set("1:0", "raw", page(100));
      cache.set("1:1", "raw", page(200));

      expect(cache.get("1:0", "raw")?.bytes.length).toBe(100);
      expect(cache.get("1:1", "raw")?.bytes.length).toBe(200);
    });
  });

  describe("TTL expiry", () => {
    it("serves an entry before its TTL elapses", () => {
      const { cache, advance } = cacheWithClock({
        maxBytes: 10_000,
        ttlMs: 1_000,
      });

      cache.set("1:0", "raw", page(100));
      advance(999);

      expect(cache.get("1:0", "raw")).toBeDefined();
    });

    it("does not serve an entry once its TTL has elapsed", () => {
      const { cache, advance } = cacheWithClock({
        maxBytes: 10_000,
        ttlMs: 1_000,
      });

      cache.set("1:0", "raw", page(100));
      advance(1_001);

      expect(cache.get("1:0", "raw")).toBeUndefined();
    });

    it("re-setting a key refreshes its TTL", () => {
      const { cache, advance } = cacheWithClock({
        maxBytes: 10_000,
        ttlMs: 1_000,
      });

      cache.set("1:0", "raw", page(100));
      advance(800);
      cache.set("1:0", "raw", page(100));
      advance(800); // 1600 since first set, but only 800 since the refresh

      expect(cache.get("1:0", "raw")).toBeDefined();
    });
  });

  describe("size-bound eviction", () => {
    it("keeps total cached bytes within the configured bound", () => {
      const cache = new InMemorySessionCache({ maxBytes: 300, ttlMs: 60_000 });
      const ids = ["1:0", "1:1", "1:2", "1:3", "1:4"];

      for (const id of ids) cache.set(id, "raw", page(100));

      const liveBytes = ids
        .map((id) => cache.get(id, "raw")?.bytes.length ?? 0)
        .reduce((a, b) => a + b, 0);
      expect(liveBytes).toBeLessThanOrEqual(300);
    });

    it("evicts the oldest entry first when the bound is exceeded", () => {
      const cache = new InMemorySessionCache({ maxBytes: 300, ttlMs: 60_000 });

      cache.set("1:0", "raw", page(100)); // oldest
      cache.set("1:1", "raw", page(100));
      cache.set("1:2", "raw", page(100)); // full at 300
      cache.set("1:3", "raw", page(100)); // pushes total to 400 -> evict oldest

      expect(cache.get("1:0", "raw")).toBeUndefined();
      expect(cache.get("1:3", "raw")).toBeDefined();
    });

    it("retains entries that still fit after an eviction", () => {
      const cache = new InMemorySessionCache({ maxBytes: 300, ttlMs: 60_000 });

      cache.set("1:0", "raw", page(100));
      cache.set("1:1", "raw", page(100));
      cache.set("1:2", "raw", page(100));
      cache.set("1:3", "raw", page(100));

      expect(cache.get("1:1", "raw")).toBeDefined();
      expect(cache.get("1:2", "raw")).toBeDefined();
    });
  });

  describe("mockability", () => {
    it("can be satisfied by a mock conforming to the port", () => {
      const stored = page(64);
      const mock: SessionCache = {
        get: vi.fn().mockReturnValue(stored),
        set: vi.fn(),
      };

      mock.set("1:0", "eink", stored);
      expect(mock.get("1:0", "eink")).toBe(stored);
      expect(mock.set).toHaveBeenCalledWith("1:0", "eink", stored);
    });
  });
});

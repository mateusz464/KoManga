import type {
  CachedPage,
  SessionCache,
} from "../../services/ports/session-cache.js";
import type { ImageProfile } from "../../services/ports/image-processor.js";

export interface InMemorySessionCacheOptions {
  readonly maxBytes: number;
  readonly ttlMs: number;
  readonly clock?: () => number;
}

interface Entry {
  readonly page: CachedPage;
  readonly storedAt: number;
}

export class InMemorySessionCache implements SessionCache {
  // Map preserves insertion order, which gives us oldest-first eviction for free.
  private readonly entries = new Map<string, Entry>();
  private readonly clock: () => number;
  private totalBytes = 0;

  constructor(private readonly options: InMemorySessionCacheOptions) {
    this.clock = options.clock ?? Date.now;
  }

  get(pageId: string, profile: ImageProfile): CachedPage | undefined {
    const key = keyFor(pageId, profile);
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;

    if (this.isExpired(entry)) {
      this.remove(key, entry);
      return undefined;
    }
    return entry.page;
  }

  set(pageId: string, profile: ImageProfile, page: CachedPage): void {
    const key = keyFor(pageId, profile);

    // Overwrite refreshes the entry: drop the old one so re-insertion moves it
    // to the newest position and resets its TTL.
    const existing = this.entries.get(key);
    if (existing !== undefined) this.remove(key, existing);

    this.entries.set(key, { page, storedAt: this.clock() });
    this.totalBytes += page.bytes.length;

    this.evictToFit();
  }

  private isExpired(entry: Entry): boolean {
    return this.clock() - entry.storedAt >= this.options.ttlMs;
  }

  // Evict oldest-first until the total byte size is within the bound.
  private evictToFit(): void {
    for (const [key, entry] of this.entries) {
      if (this.totalBytes <= this.options.maxBytes) break;
      this.remove(key, entry);
    }
  }

  private remove(key: string, entry: Entry): void {
    this.entries.delete(key);
    this.totalBytes -= entry.page.bytes.length;
  }
}

function keyFor(pageId: string, profile: ImageProfile): string {
  return `${pageId} ${profile}`;
}

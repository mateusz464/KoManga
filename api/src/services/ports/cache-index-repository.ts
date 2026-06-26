// Durable bookkeeping for the session cache (RFC §7): keys, sizes and TTLs only,
// never the page bytes — so pruning can be driven from a persistent index.

/**
 * One bookkeeping row for a cached page. `key` is the session cache's composite
 * key (page id + profile), so `raw` and `eink` of one page are distinct rows.
 */
export interface CacheIndexEntry {
  readonly key: string;
  readonly sizeBytes: number;
  /** Epoch milliseconds the entry was stored. */
  readonly storedAt: number;
  /** Epoch milliseconds the entry expires (TTL). */
  readonly expiresAt: number;
}

export interface CacheIndexRepository {
  /** Returns the bookkeeping row for a key, or `undefined` if absent. */
  get(key: string): CacheIndexEntry | undefined;

  /** Inserts or replaces the row for `entry.key`. */
  upsert(entry: CacheIndexEntry): void;

  /** Removes the row for a key (no-op if absent). */
  delete(key: string): void;

  /** All bookkeeping rows. Empty array when the index is empty. */
  list(): CacheIndexEntry[];

  /** Sum of `sizeBytes` across all rows — the live size used for pruning. */
  totalBytes(): number;
}

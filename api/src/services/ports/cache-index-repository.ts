// Port (interface) for session-cache bookkeeping (RFC §7, CLAUDE.md §8).
//
// `cache_index` records the keys, sizes and TTLs of entries in the ephemeral
// session cache so pruning can be driven from durable bookkeeping. It owns
// bookkeeping ONLY — never the page bytes, and never anything to do with the
// persistent CBZ download store.
//
// Services depend on this interface, never a concrete adapter, so it can be
// mocked in upstream tests and the storage swapped without changing callers.

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

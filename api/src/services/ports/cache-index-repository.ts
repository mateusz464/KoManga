// Durable bookkeeping for the session cache (RFC §7): keys, sizes and TTLs only,
// never the page bytes — so pruning can be driven from a persistent index.

export interface CacheIndexEntry {
  // The session cache's composite key (page id + profile), so raw and eink of
  // one page are distinct rows.
  readonly key: string;
  readonly sizeBytes: number;
  readonly storedAt: number; // epoch ms
  readonly expiresAt: number; // epoch ms
}

export interface CacheIndexRepository {
  get(key: string): CacheIndexEntry | undefined;
  upsert(entry: CacheIndexEntry): void;
  delete(key: string): void;
  list(): CacheIndexEntry[];
  totalBytes(): number;
}

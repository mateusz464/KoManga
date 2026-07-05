export interface CacheIndexEntry {
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

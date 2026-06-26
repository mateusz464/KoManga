// SQLite implementation of the CacheIndexRepository port (RFC §7).
//
// Stub for API-501 (the [TEST] ticket); the real CRUD lands in API-502.
// Methods throw so the contract tests run and fail red.

import type {
  CacheIndexEntry,
  CacheIndexRepository,
} from "../../services/ports/cache-index-repository.js";
import type { AppDatabase } from "./database.js";

export class SqliteCacheIndexRepository implements CacheIndexRepository {
  constructor(private readonly db: AppDatabase) {}

  get(_key: string): CacheIndexEntry | undefined {
    throw new Error("CacheIndexRepository.get not implemented (API-502)");
  }

  upsert(_entry: CacheIndexEntry): void {
    throw new Error("CacheIndexRepository.upsert not implemented (API-502)");
  }

  delete(_key: string): void {
    throw new Error("CacheIndexRepository.delete not implemented (API-502)");
  }

  list(): CacheIndexEntry[] {
    throw new Error("CacheIndexRepository.list not implemented (API-502)");
  }

  totalBytes(): number {
    throw new Error("CacheIndexRepository.totalBytes not implemented (API-502)");
  }
}

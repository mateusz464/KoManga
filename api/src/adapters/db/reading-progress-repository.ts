// SQLite implementation of the ReadingProgressRepository port (RFC §7).
//
// Stub for API-501 (the [TEST] ticket); the real CRUD + last-write-wins lands
// in API-502. Methods throw so the contract tests run and fail red.

import type {
  ReadingProgress,
  ReadingProgressRepository,
} from "../../services/ports/reading-progress-repository.js";
import type { AppDatabase } from "./database.js";

export class SqliteReadingProgressRepository
  implements ReadingProgressRepository
{
  constructor(private readonly db: AppDatabase) {}

  get(_mangaId: string): ReadingProgress | undefined {
    throw new Error("ReadingProgressRepository.get not implemented (API-502)");
  }

  save(_progress: ReadingProgress): void {
    throw new Error("ReadingProgressRepository.save not implemented (API-502)");
  }
}

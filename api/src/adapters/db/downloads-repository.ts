// SQLite implementation of the DownloadsRepository port (RFC §7).
//
// Stub for API-501 (the [TEST] ticket); the real CRUD + idempotent create
// lands in API-502. Methods throw so the contract tests run and fail red.

import type {
  DownloadRecord,
  DownloadStatus,
  DownloadsRepository,
} from "../../services/ports/downloads-repository.js";
import type { AppDatabase } from "./database.js";

export class SqliteDownloadsRepository implements DownloadsRepository {
  constructor(private readonly db: AppDatabase) {}

  get(_chapterId: string): DownloadRecord | undefined {
    throw new Error("DownloadsRepository.get not implemented (API-502)");
  }

  list(): DownloadRecord[] {
    throw new Error("DownloadsRepository.list not implemented (API-502)");
  }

  create(_record: DownloadRecord): void {
    throw new Error("DownloadsRepository.create not implemented (API-502)");
  }

  updateStatus(_chapterId: string, _status: DownloadStatus): void {
    throw new Error(
      "DownloadsRepository.updateStatus not implemented (API-502)",
    );
  }
}

// Bookkeeping rows in OUR SQLite for chapters downloaded as CBZ (RFC §7); the
// CBZ bytes themselves live in the separate DownloadStore.

/** Lifecycle of a download: queued, finished on disk, or failed to build. */
export type DownloadStatus = "pending" | "completed" | "failed";

/** A persisted download record. Keyed by `chapterId` — one row per chapter. */
export interface DownloadRecord {
  readonly chapterId: string;
  readonly mangaId: string;
  /** Path to the stored CBZ on the persistent volume. */
  readonly cbzPath: string;
  readonly status: DownloadStatus;
  /** Epoch milliseconds the record was created. */
  readonly createdAt: number;
}

export interface DownloadsRepository {
  /** Returns the record for a chapter, or `undefined` if not downloaded. */
  get(chapterId: string): DownloadRecord | undefined;

  /** All download records. Empty array when nothing has been downloaded. */
  list(): DownloadRecord[];

  /**
   * Inserts a download record. Idempotent: if a record already exists for
   * `record.chapterId`, the existing row is kept unchanged (re-download of an
   * existing chapter must not create a duplicate).
   */
  create(record: DownloadRecord): void;

  /** Updates the lifecycle status of an existing download. */
  updateStatus(chapterId: string, status: DownloadStatus): void;
}

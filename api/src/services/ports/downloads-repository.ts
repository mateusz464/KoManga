// Port (interface) for the persistent download records (RFC §7, CLAUDE.md §8).
//
// Tracks chapters the user explicitly chose to download as CBZ. This is only
// the bookkeeping row in OUR SQLite — the CBZ bytes live on a separate Docker
// volume (the persistent store), never in the ephemeral session cache, and are
// never auto-pruned by cache logic.
//
// Services depend on this interface, never a concrete adapter, so it can be
// mocked in upstream tests (API-505) and the storage swapped without changing
// callers.

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

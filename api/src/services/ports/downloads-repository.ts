// Bookkeeping rows in OUR SQLite for chapters downloaded as CBZ (RFC §7); the
// CBZ bytes themselves live in the separate DownloadStore.

export type DownloadStatus = "pending" | "completed" | "failed";

// Keyed by chapterId — one row per chapter.
export interface DownloadRecord {
  readonly chapterId: string;
  readonly mangaId: string;
  readonly cbzPath: string;
  readonly status: DownloadStatus;
  readonly createdAt: number; // epoch ms
}

export interface DownloadsRepository {
  get(chapterId: string): DownloadRecord | undefined;
  list(): DownloadRecord[];
  // Idempotent: an existing row for the chapter is kept unchanged, so a
  // re-download never creates a duplicate.
  create(record: DownloadRecord): void;
  updateStatus(chapterId: string, status: DownloadStatus): void;
}

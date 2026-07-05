export type DownloadStatus = "pending" | "completed" | "failed";

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
  // Idempotent: an existing row for the chapter is kept unchanged.
  create(record: DownloadRecord): void;
  updateStatus(chapterId: string, status: DownloadStatus): void;
}

// Device-agnostic: keyed by manga only, never a device id, so all clients share
// one position.
export interface ReadingProgress {
  readonly mangaId: string;
  readonly chapterId: string;
  readonly page: number; // 0-based index within the chapter
  readonly updatedAt: number; // epoch ms
}

export interface ReadingProgressRepository {
  get(mangaId: string): ReadingProgress | undefined;
  // Last-write-wins: only replaces the stored row when the incoming updatedAt is
  // newer than or equal to it, so a stale write can't clobber a newer one.
  save(progress: ReadingProgress): void;
}

// Reading-progress persistence (RFC §7, CLAUDE.md §8). Device-agnostic: keyed by
// manga only, never by a device id, so all clients share one position. Resolution
// is last-write-wins by updatedAt (sufficient for a single user).

export interface ReadingProgress {
  readonly mangaId: string;
  readonly chapterId: string;
  readonly page: number; // 0-based index within the chapter
  readonly updatedAt: number; // epoch ms; drives last-write-wins
}

export interface ReadingProgressRepository {
  get(mangaId: string): ReadingProgress | undefined;
  // Last-write-wins: only replaces the stored row when the incoming updatedAt is
  // newer than or equal to it, so a stale write can't clobber a newer one.
  save(progress: ReadingProgress): void;
}

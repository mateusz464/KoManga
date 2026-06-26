// Port (interface) for reading-progress persistence (RFC §7, CLAUDE.md §8).
//
// Reading progress is OUR data, owned by this service's SQLite — never
// duplicated from Suwayomi. It is device-agnostic: keyed by manga only, never
// by a device id, so the Kobo, web and mobile clients share one position.
// Resolution is last-write-wins by `updatedAt` (sufficient for a single user).
//
// Services depend on this interface, never a concrete adapter, so it can be
// mocked in upstream tests (API-601) and the storage swapped without changing
// callers.

/** One manga's reading position. No device identifier — progress is shared. */
export interface ReadingProgress {
  readonly mangaId: string;
  readonly chapterId: string;
  /** 0-based page index within the chapter. */
  readonly page: number;
  /** Epoch milliseconds; drives last-write-wins resolution. */
  readonly updatedAt: number;
}

export interface ReadingProgressRepository {
  /** Returns the stored position for a manga, or `undefined` if none exists. */
  get(mangaId: string): ReadingProgress | undefined;

  /**
   * Stores the position for `progress.mangaId`, last-write-wins: an incoming
   * write only replaces the stored row when its `updatedAt` is newer than or
   * equal to the stored one. An older write must not clobber a newer one.
   */
  save(progress: ReadingProgress): void;
}

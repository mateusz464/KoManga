// Port (interface) for the library / follows store (RFC §7, CLAUDE.md §8).
//
// The library is OUR data, owned by this service's SQLite. It records only the
// manga the user has followed — never a copy of Suwayomi's catalogue metadata
// (title, cover, chapters): those are fetched from Suwayomi on demand. An entry
// is therefore just a reference (the manga id) plus when it was followed.
//
// Like reading progress, it is device-agnostic — keyed by manga only, never by
// a device id — so the Kobo, web and mobile clients share one library.
//
// Services depend on this interface, never a concrete adapter, so it can be
// mocked in upstream tests (API-603) and the storage swapped without changing
// callers.

/** One followed manga. No catalogue metadata — just the reference + timestamp. */
export interface LibraryEntry {
  readonly mangaId: string;
  /** Epoch milliseconds the manga was added to the library. */
  readonly addedAt: number;
}

export interface LibraryRepository {
  /** Every followed manga. Empty array when the library is empty. */
  list(): LibraryEntry[];

  /**
   * Follows a manga. Idempotent: if `entry.mangaId` is already in the library
   * the existing row is kept unchanged, so re-following must not create a
   * duplicate.
   */
  add(entry: LibraryEntry): void;

  /** Unfollows a manga (no-op if it was not in the library). */
  remove(mangaId: string): void;
}

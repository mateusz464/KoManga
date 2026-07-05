// The library / follows store (RFC §7, CLAUDE.md §8). Records only a reference to
// each followed manga — never a copy of Suwayomi's catalogue metadata (fetched on
// demand). Device-agnostic like reading progress: keyed by manga only, never by a
// device id, so all clients share one library.

export interface LibraryEntry {
  readonly mangaId: string;
  // Display title captured at follow time (API-907) so a client's library/home
  // view can show the manga name without a per-entry Suwayomi fan-out on list
  // (CLAUDE.md §8) — offline-friendly. Optional so a pre-title row degrades
  // gracefully (nullable / backfilled).
  readonly title?: string;
  readonly addedAt: number; // epoch ms
}

export interface LibraryRepository {
  list(): LibraryEntry[];
  // Idempotent: an existing row for the manga is kept unchanged.
  add(entry: LibraryEntry): void;
  remove(mangaId: string): void;
}

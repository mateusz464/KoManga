export interface LibraryEntry {
  readonly mangaId: string;
  // Captured at follow time so listing the library needs no per-entry Suwayomi
  // fan-out; optional so pre-title rows degrade gracefully.
  readonly title?: string;
  readonly addedAt: number; // epoch ms
}

export interface LibraryRepository {
  list(): LibraryEntry[];
  // Idempotent: an existing row for the manga is kept unchanged.
  add(entry: LibraryEntry): void;
  remove(mangaId: string): void;
}

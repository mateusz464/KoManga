import type {
  LibraryEntry,
  LibraryRepository,
} from "./ports/library-repository.js";

export class LibraryService {
  constructor(private readonly repository: LibraryRepository) {}

  list(): LibraryEntry[] {
    return this.repository.list();
  }

  // Idempotent at the repository: re-following keeps the original row.
  follow(entry: LibraryEntry): LibraryEntry {
    this.repository.add(entry);
    return entry;
  }

  unfollow(mangaId: string): void {
    this.repository.remove(mangaId);
  }
}

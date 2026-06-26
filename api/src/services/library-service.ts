import type {
  LibraryEntry,
  LibraryRepository,
} from "./ports/library-repository.js";

export class LibraryService {
  constructor(private readonly repository: LibraryRepository) {}

  list(): LibraryEntry[] {
    return this.repository.list();
  }

  // Idempotent at the repository: re-following keeps the original row. We return
  // the entry the caller asked to follow.
  follow(entry: LibraryEntry): LibraryEntry {
    this.repository.add(entry);
    return entry;
  }

  // No-op at the repository if the manga was not followed.
  unfollow(mangaId: string): void {
    this.repository.remove(mangaId);
  }
}

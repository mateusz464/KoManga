import type {
  ReadingProgress,
  ReadingProgressRepository,
} from "./ports/reading-progress-repository.js";
import { NotFoundError } from "../http/errors.js";

export class ProgressService {
  constructor(private readonly repository: ReadingProgressRepository) {}

  // Save then re-read the RESOLVED position: the repo is last-write-wins, so a
  // stale write is a no-op and the read returns the newer stored value.
  save(progress: ReadingProgress): ReadingProgress {
    this.repository.save(progress);
    const stored = this.repository.get(progress.mangaId);
    if (stored === undefined) {
      throw new NotFoundError(`No progress for manga '${progress.mangaId}'`);
    }
    return stored;
  }

  get(mangaId: string): ReadingProgress {
    const stored = this.repository.get(mangaId);
    if (stored === undefined) {
      throw new NotFoundError(`No progress for manga '${mangaId}'`);
    }
    return stored;
  }
}

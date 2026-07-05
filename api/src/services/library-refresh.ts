import type { LibraryRepository } from "./ports/library-repository.js";
import type { SuwayomiClient } from "./ports/suwayomi-client.js";
import type { Logger } from "./ports/logger.js";

export interface RefreshOptions {
  readonly concurrency?: number;
  readonly logger?: Logger;
}

const DEFAULT_CONCURRENCY = 4;

// `fetchChapters` (not `listChapters`) is deliberate: it triggers Suwayomi's
// source scrape so the stored chapter list — which the library's caught-up state
// reads — surfaces new releases without the user reopening the manga.
export async function refreshFollowedChapters(
  library: LibraryRepository,
  suwayomi: SuwayomiClient,
  options: RefreshOptions = {},
): Promise<void> {
  const entries = library.list();
  if (entries.length === 0) return;

  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const queue = [...entries];

  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const { mangaId } = next;
      try {
        await suwayomi.fetchChapters(mangaId);
      } catch (error) {
        options.logger?.error("Library refresh: chapter scrape failed", {
          mangaId,
          error,
        });
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, entries.length) },
    () => worker(),
  );
  await Promise.all(workers);
}

import type { LibraryRepository } from "./ports/library-repository.js";
import type { SuwayomiClient } from "./ports/suwayomi-client.js";

export interface RefreshOptions {
  /** Max concurrent source fetches; a small cap so refreshing many followed
   * manga doesn't hammer sources all at once (RFC §13, CLAUDE.md §8). */
  readonly concurrency?: number;
}

// API-914 implements the bounded, failure-isolated refresh pass and schedules it.
// This stub lets the API-913 contract tests compile and run red until then.
export async function refreshFollowedChapters(
  _library: LibraryRepository,
  _suwayomi: SuwayomiClient,
  _options: RefreshOptions = {},
): Promise<void> {}

import type { LibraryRepository } from "./ports/library-repository.js";
import type { SuwayomiClient } from "./ports/suwayomi-client.js";
import {
  refreshFollowedChapters,
  type RefreshOptions,
} from "./library-refresh.js";

export interface ScheduleOptions extends RefreshOptions {
  readonly intervalMs: number;
  readonly runOnStart?: boolean;
}

export interface ScheduledRefresh {
  stop(): void;
}

export function scheduleFollowedChapterRefresh(
  library: LibraryRepository,
  suwayomi: SuwayomiClient,
  options: ScheduleOptions,
): ScheduledRefresh {
  const { intervalMs, runOnStart, logger, concurrency } = options;
  const refreshOptions: RefreshOptions = { concurrency, logger };

  const run = (): void => {
    refreshFollowedChapters(library, suwayomi, refreshOptions).catch(
      (error) => {
        logger?.error("Library refresh pass failed", { error });
      },
    );
  };

  if (runOnStart) run();

  const timer = setInterval(run, intervalMs);
  // Detach: the refresh timer alone must not keep the process alive.
  timer.unref?.();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}

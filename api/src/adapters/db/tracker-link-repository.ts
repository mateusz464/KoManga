import type { TrackerService } from "../../services/ports/tracker-account-repository.js";
import type {
  TrackerLink,
  TrackerLinkRepository,
  TrackerMatch,
} from "../../services/ports/tracker-link-repository.js";
import type { AppDatabase } from "./database.js";

export class SqliteTrackerLinkRepository implements TrackerLinkRepository {
  constructor(private readonly db: AppDatabase) {
    void this.db;
  }

  get(_mangaId: string, _service: TrackerService): TrackerLink | undefined {
    throw new Error("SqliteTrackerLinkRepository is not implemented");
  }

  setMatch(_match: TrackerMatch): void {
    throw new Error("SqliteTrackerLinkRepository is not implemented");
  }

  clearMatch(_mangaId: string, _service: TrackerService): void {
    throw new Error("SqliteTrackerLinkRepository is not implemented");
  }

  setDoNotTrack(
    _mangaId: string,
    _service: TrackerService,
    _doNotTrack: boolean,
  ): void {
    throw new Error("SqliteTrackerLinkRepository is not implemented");
  }

  updateLastSynced(
    _mangaId: string,
    _service: TrackerService,
    _lastSyncedChapter: number,
  ): void {
    throw new Error("SqliteTrackerLinkRepository is not implemented");
  }
}

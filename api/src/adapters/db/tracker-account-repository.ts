import type {
  TrackerAccount,
  TrackerAccountRepository,
  TrackerService,
} from "../../services/ports/tracker-account-repository.js";
import type { AppDatabase } from "./database.js";

export class SqliteTrackerAccountRepository implements TrackerAccountRepository {
  constructor(private readonly db: AppDatabase) {
    void this.db;
  }

  get(_service: TrackerService): TrackerAccount | undefined {
    throw new Error("SqliteTrackerAccountRepository is not implemented");
  }

  upsert(_account: TrackerAccount): void {
    throw new Error("SqliteTrackerAccountRepository is not implemented");
  }
}

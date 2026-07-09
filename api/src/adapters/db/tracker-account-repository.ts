import type {
  TrackerAccount,
  TrackerAccountRepository,
  TrackerService,
} from "../../services/ports/tracker-account-repository.js";
import type { AppDatabase } from "./database.js";

interface Row {
  service: TrackerService;
  access_token: string;
  token_type: string;
  expires_at: number;
  anilist_user_id: string;
  username: string;
}

function toAccount(row: Row): TrackerAccount {
  return {
    service: row.service,
    accessToken: row.access_token,
    tokenType: row.token_type,
    expiresAt: row.expires_at,
    anilistUserId: row.anilist_user_id,
    username: row.username,
  };
}

export class SqliteTrackerAccountRepository implements TrackerAccountRepository {
  constructor(private readonly db: AppDatabase) {}

  get(service: TrackerService): TrackerAccount | undefined {
    const row = this.db
      .prepare("SELECT * FROM tracker_account WHERE service = ?")
      .get(service) as Row | undefined;
    return row === undefined ? undefined : toAccount(row);
  }

  upsert(account: TrackerAccount): void {
    this.db
      .prepare(
        `INSERT INTO tracker_account
           (service, access_token, token_type, expires_at, anilist_user_id, username)
         VALUES (@service, @accessToken, @tokenType, @expiresAt, @anilistUserId, @username)
         ON CONFLICT(service) DO UPDATE SET
           access_token    = excluded.access_token,
           token_type      = excluded.token_type,
           expires_at      = excluded.expires_at,
           anilist_user_id = excluded.anilist_user_id,
           username        = excluded.username`,
      )
      .run(account);
  }

  delete(service: TrackerService): void {
    this.db
      .prepare("DELETE FROM tracker_account WHERE service = ?")
      .run(service);
  }
}

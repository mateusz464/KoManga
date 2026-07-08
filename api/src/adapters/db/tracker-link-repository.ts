import type { TrackerService } from "../../services/ports/tracker-account-repository.js";
import type {
  TrackerLink,
  TrackerLinkRepository,
  TrackerMatch,
} from "../../services/ports/tracker-link-repository.js";
import type { AppDatabase } from "./database.js";

interface Row {
  manga_id: string;
  service: TrackerService;
  media_id: string | null;
  last_synced_chapter: number | null;
  do_not_track: 0 | 1;
}

function toLink(row: Row): TrackerLink {
  return {
    mangaId: row.manga_id,
    service: row.service,
    ...(row.media_id == null ? {} : { mediaId: row.media_id }),
    ...(row.last_synced_chapter == null
      ? {}
      : { lastSyncedChapter: row.last_synced_chapter }),
    doNotTrack: row.do_not_track === 1,
  };
}

export class SqliteTrackerLinkRepository implements TrackerLinkRepository {
  constructor(private readonly db: AppDatabase) {}

  get(mangaId: string, service: TrackerService): TrackerLink | undefined {
    const row = this.db
      .prepare("SELECT * FROM tracker_link WHERE manga_id = ? AND service = ?")
      .get(mangaId, service) as Row | undefined;
    return row === undefined ? undefined : toLink(row);
  }

  setMatch(match: TrackerMatch): void {
    this.db
      .prepare(
        `INSERT INTO tracker_link (manga_id, service, media_id, do_not_track)
         VALUES (@mangaId, @service, @mediaId, 0)
         ON CONFLICT(manga_id, service) DO UPDATE SET
           media_id = excluded.media_id`,
      )
      .run(match);
  }

  clearMatch(mangaId: string, service: TrackerService): void {
    this.db
      .prepare(
        `UPDATE tracker_link
         SET media_id = NULL
         WHERE manga_id = ? AND service = ?`,
      )
      .run(mangaId, service);
  }

  setDoNotTrack(
    mangaId: string,
    service: TrackerService,
    doNotTrack: boolean,
  ): void {
    this.db
      .prepare(
        `INSERT INTO tracker_link (manga_id, service, do_not_track)
         VALUES (?, ?, ?)
         ON CONFLICT(manga_id, service) DO UPDATE SET
           do_not_track = excluded.do_not_track`,
      )
      .run(mangaId, service, doNotTrack ? 1 : 0);
  }

  updateLastSynced(
    mangaId: string,
    service: TrackerService,
    lastSyncedChapter: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO tracker_link
           (manga_id, service, last_synced_chapter, do_not_track)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(manga_id, service) DO UPDATE SET
           last_synced_chapter = excluded.last_synced_chapter`,
      )
      .run(mangaId, service, lastSyncedChapter);
  }
}

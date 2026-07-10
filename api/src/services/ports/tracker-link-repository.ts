import type { TrackerService } from "./tracker-account-repository.js";

export interface TrackerLink {
  readonly mangaId: string;
  readonly service: TrackerService;
  readonly mediaId?: string;
  readonly lastSyncedChapter?: number;
  readonly doNotTrack: boolean;
}

export interface TrackerMatch {
  readonly mangaId: string;
  readonly service: TrackerService;
  readonly mediaId: string;
}

export interface TrackerLinkRepository {
  get(mangaId: string, service: TrackerService): TrackerLink | undefined;
  setMatch(match: TrackerMatch): void;
  clearMatch(mangaId: string, service: TrackerService): void;
  setDoNotTrack(
    mangaId: string,
    service: TrackerService,
    doNotTrack: boolean,
  ): void;
  updateLastSynced(
    mangaId: string,
    service: TrackerService,
    lastSyncedChapter: number,
  ): void;
}

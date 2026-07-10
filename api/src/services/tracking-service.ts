import { BadRequestError } from "../http/errors.js";
import type { Logger } from "./ports/logger.js";
import type { SuwayomiClient } from "./ports/suwayomi-client.js";
import type {
  Tracker,
  TrackerListEntry,
  TrackerMediaCandidate,
  TrackerStatus,
} from "./ports/tracker.js";
import type {
  TrackerAccount,
  TrackerAccountRepository,
  TrackerService,
} from "./ports/tracker-account-repository.js";
import type {
  TrackerLink,
  TrackerLinkRepository,
} from "./ports/tracker-link-repository.js";

const SERVICE: TrackerService = "anilist";

const noop = (): void => undefined;
const NOOP_LOGGER: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

export type TrackerMatchState =
  | "matched"
  | "unmatched"
  | "do_not_track"
  | "no_account";

export interface TrackerCandidates {
  readonly mangaId: string;
  readonly candidates: readonly TrackerMediaCandidate[];
}

export interface TrackerStatusView {
  readonly mangaId: string;
  readonly service: TrackerService;
  readonly state: TrackerMatchState;
  readonly account: {
    readonly linked: boolean;
    readonly needsRelink: boolean;
  };
  readonly media: { readonly mediaId: string } | null;
  readonly lastSyncedChapter: number | null;
  readonly doNotTrack: boolean;
}

export type TrackerAccountStatus =
  | { readonly linked: false }
  | {
      readonly linked: true;
      readonly account: {
        readonly anilistUserId: string;
        readonly username: string;
      };
    };

export class TrackingService {
  constructor(
    private readonly suwayomi: SuwayomiClient,
    private readonly tracker: Tracker,
    private readonly accounts: TrackerAccountRepository,
    private readonly links: TrackerLinkRepository,
    private readonly logger: Logger = NOOP_LOGGER,
  ) {}

  async candidates(mangaId: string): Promise<TrackerCandidates> {
    const manga = await this.suwayomi.getMangaDetails(mangaId);
    return {
      mangaId,
      candidates: await this.tracker.searchMedia(manga.title),
    };
  }

  async accountStatus(): Promise<TrackerAccountStatus> {
    const account = this.accounts.get(SERVICE);
    if (!account) {
      return { linked: false };
    }

    const identified = await this.backfillIdentity(account);
    return {
      linked: true,
      account: {
        anilistUserId: identified.anilistUserId,
        username: identified.username,
      },
    };
  }

  // Accounts linked before the viewer lookup existed were stored with a blank
  // or "unknown" identity; recover it once from AniList and persist it.
  private async backfillIdentity(
    account: TrackerAccount,
  ): Promise<TrackerAccount> {
    if (
      (account.username !== "" && account.username !== "unknown") ||
      !this.tracker.getViewer
    ) {
      return account;
    }

    try {
      const viewer = await this.tracker.getViewer(account.accessToken);
      const identified = {
        ...account,
        anilistUserId: viewer.userId,
        username: viewer.username,
      };
      this.accounts.upsert(identified);
      return identified;
    } catch (error) {
      this.logger.warn("AniList viewer backfill failed", { error });
      return account;
    }
  }

  unlinkAccount(): { readonly linked: false } {
    this.accounts.delete(SERVICE);
    return { linked: false };
  }

  setMatch(
    mangaId: string,
    mediaId: string,
  ): { mangaId: string; service: TrackerService; mediaId: string } {
    if (mediaId.trim() === "") {
      throw new BadRequestError(
        "Body field 'mediaId' must be a non-empty string",
      );
    }

    const match = { mangaId, service: SERVICE, mediaId };
    this.links.setMatch(match);
    return match;
  }

  clearMatch(mangaId: string): {
    mangaId: string;
    service: TrackerService;
    mediaId: null;
  } {
    this.links.clearMatch(mangaId, SERVICE);
    return { mangaId, service: SERVICE, mediaId: null };
  }

  setDoNotTrack(mangaId: string): {
    mangaId: string;
    service: TrackerService;
    doNotTrack: true;
  } {
    this.links.setDoNotTrack(mangaId, SERVICE, true);
    return { mangaId, service: SERVICE, doNotTrack: true };
  }

  status(mangaId: string): TrackerStatusView {
    const account = this.accounts.get(SERVICE);
    const link = this.links.get(mangaId, SERVICE);
    const hasAccount = account !== undefined;
    const doNotTrack = link?.doNotTrack ?? false;
    const mediaId = link?.mediaId;

    return {
      mangaId,
      service: SERVICE,
      state: stateFor({ hasAccount, doNotTrack, mediaId }),
      account: {
        linked: hasAccount,
        needsRelink: accountNeedsRelink(account),
      },
      media: hasAccount && mediaId ? { mediaId } : null,
      lastSyncedChapter: link?.lastSyncedChapter ?? null,
      doNotTrack,
    };
  }

  async completeChapter(chapterId: string): Promise<void> {
    try {
      const chapter = await this.suwayomi.getChapterDetails(chapterId);
      const account = this.accounts.get(SERVICE);
      const link = this.links.get(chapter.mangaId, SERVICE);

      if (!account || !isTrackable(link)) {
        return;
      }

      const finishedChapter = Math.floor(chapter.chapterNumber);
      const listEntry = await this.getListEntry(link.mediaId, account);
      const guard = Math.max(
        link.lastSyncedChapter ?? listEntry?.progress ?? 0,
        listEntry?.progress ?? 0,
      );

      if (finishedChapter <= guard) {
        if (link.lastSyncedChapter === undefined) {
          this.links.updateLastSynced(chapter.mangaId, SERVICE, guard);
        }
        return;
      }

      await this.saveProgress(
        link.mediaId,
        finishedChapter,
        statusFor(finishedChapter, listEntry),
        account,
      );
      this.links.updateLastSynced(chapter.mangaId, SERVICE, finishedChapter);
    } catch (error) {
      this.logger.error("Chapter completion sync failed", { error, chapterId });
    }
  }

  private getListEntry(
    mediaId: string,
    account: TrackerAccount,
  ): Promise<TrackerListEntry | null> {
    if (this.tracker.getListEntry.length >= 2) {
      return this.tracker.getListEntry(mediaId, account.accessToken);
    }
    return this.tracker.getListEntry(mediaId);
  }

  private saveProgress(
    mediaId: string,
    progress: number,
    status: TrackerStatus,
    account: TrackerAccount,
  ): Promise<TrackerListEntry> {
    if (this.tracker.saveProgress.length >= 4) {
      return this.tracker.saveProgress(
        mediaId,
        progress,
        status,
        account.accessToken,
      );
    }
    return this.tracker.saveProgress(mediaId, progress, status);
  }
}

function stateFor(options: {
  readonly hasAccount: boolean;
  readonly doNotTrack: boolean;
  readonly mediaId?: string;
}): TrackerMatchState {
  if (!options.hasAccount) {
    return "no_account";
  }
  if (options.doNotTrack) {
    return "do_not_track";
  }
  if (options.mediaId) {
    return "matched";
  }
  return "unmatched";
}

function accountNeedsRelink(account: TrackerAccount | undefined): boolean {
  return account === undefined || account.expiresAt <= Date.now();
}

function isTrackable(
  link: TrackerLink | undefined,
): link is TrackerLink & { readonly mediaId: string } {
  return link !== undefined && !link.doNotTrack && link.mediaId !== undefined;
}

function statusFor(
  progress: number,
  entry: TrackerListEntry | null,
): TrackerStatus {
  return entry?.totalChapters !== undefined && progress >= entry.totalChapters
    ? "completed"
    : "reading";
}

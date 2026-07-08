import { BadRequestError } from "../http/errors.js";
import type { SuwayomiClient } from "./ports/suwayomi-client.js";
import type { Tracker, TrackerMediaCandidate } from "./ports/tracker.js";
import type {
  TrackerAccount,
  TrackerAccountRepository,
  TrackerService,
} from "./ports/tracker-account-repository.js";
import type { TrackerLinkRepository } from "./ports/tracker-link-repository.js";

const SERVICE: TrackerService = "anilist";

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

export class TrackingService {
  constructor(
    private readonly suwayomi: SuwayomiClient,
    private readonly tracker: Tracker,
    private readonly accounts: TrackerAccountRepository,
    private readonly links: TrackerLinkRepository,
  ) {}

  async candidates(mangaId: string): Promise<TrackerCandidates> {
    const manga = await this.suwayomi.getMangaDetails(mangaId);
    return {
      mangaId,
      candidates: await this.tracker.searchMedia(manga.title),
    };
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

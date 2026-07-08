import type {
  Tracker,
  TrackerListEntry,
  TrackerMediaCandidate,
  TrackerStatus,
  TrackerToken,
} from "../../services/ports/tracker.js";

export interface AniListTokenRequest {
  readonly grant_type: "authorization_code";
  readonly client_id: string;
  readonly client_secret: string;
  readonly redirect_uri: string;
  readonly code: string;
}

export interface AniListTransport {
  request(
    document: string,
    variables?: Record<string, unknown>,
    accessToken?: string,
  ): Promise<unknown>;
  postToken(request: AniListTokenRequest): Promise<unknown>;
}

export interface AniListTrackerOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly accessToken?: string;
}

export class AniListTracker implements Tracker {
  constructor(
    private readonly transport: AniListTransport,
    private readonly options: AniListTrackerOptions,
  ) {
    void this.transport;
    void this.options;
  }

  exchangeCode(_code: string): Promise<TrackerToken> {
    throw new Error("AniList tracker exchangeCode not implemented");
  }

  searchMedia(_title: string): Promise<TrackerMediaCandidate[]> {
    throw new Error("AniList tracker searchMedia not implemented");
  }

  getListEntry(_mediaId: string): Promise<TrackerListEntry | null> {
    throw new Error("AniList tracker getListEntry not implemented");
  }

  saveProgress(
    _mediaId: string,
    _progress: number,
    _status: TrackerStatus,
  ): Promise<TrackerListEntry> {
    throw new Error("AniList tracker saveProgress not implemented");
  }
}

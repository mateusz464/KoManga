import {
  TrackerError,
  type Tracker,
  type TrackerListEntry,
  type TrackerMediaCandidate,
  type TrackerStatus,
  type TrackerToken,
  type TrackerViewer,
} from "../../../services/ports/tracker.js";
import {
  GET_LIST_ENTRY,
  SAVE_PROGRESS,
  SEARCH_MEDIA,
  VIEWER,
} from "./anilist-documents.js";
import { isGraphQLResponseError } from "./anilist-errors.js";
import { toIntId } from "./anilist-ids.js";
import {
  mapListEntry,
  mapMediaCandidate,
  mapToken,
} from "./anilist-mappers.js";
import { toAniListStatus } from "./anilist-status.js";
import type {
  AniListTrackerOptions,
  AniListTransport,
} from "./anilist-types.js";
import type {
  RawListEntry,
  RawMedia,
  RawMediaWithListEntry,
} from "./anilist-wire-types.js";

export class AniListTracker implements Tracker {
  constructor(
    private readonly transport: AniListTransport,
    private readonly options: AniListTrackerOptions,
  ) {}

  async exchangeCode(code: string): Promise<TrackerToken> {
    try {
      const data = await this.transport.postToken({
        grant_type: "authorization_code",
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        redirect_uri: this.options.redirectUri,
        code,
      });
      return mapToken(data);
    } catch (cause) {
      throw new TrackerError("token_exchange", cause);
    }
  }

  async getViewer(accessToken: string): Promise<TrackerViewer> {
    const data = await this.runGraphQL<{
      Viewer?: { id?: number; name?: string };
    }>(VIEWER, undefined, accessToken);
    if (
      typeof data.Viewer?.id !== "number" ||
      typeof data.Viewer.name !== "string"
    ) {
      throw new TrackerError("graphql");
    }
    return { userId: String(data.Viewer.id), username: data.Viewer.name };
  }

  async searchMedia(title: string): Promise<TrackerMediaCandidate[]> {
    const data = await this.runGraphQL<{ Page?: { media?: RawMedia[] } }>(
      SEARCH_MEDIA,
      { search: title },
    );
    return (data.Page?.media ?? []).map(mapMediaCandidate);
  }

  async getListEntry(
    mediaId: string,
    accessToken?: string,
  ): Promise<TrackerListEntry | null> {
    const data = await this.runGraphQL<{
      Media?: RawMediaWithListEntry | null;
    }>(GET_LIST_ENTRY, { mediaId: toIntId(mediaId) }, accessToken);
    const media = data.Media;
    if (!media?.mediaListEntry) {
      return null;
    }
    return {
      ...mapListEntry(media.mediaListEntry),
      ...(typeof media.chapters === "number"
        ? { totalChapters: media.chapters }
        : {}),
    };
  }

  async saveProgress(
    mediaId: string,
    progress: number,
    status: TrackerStatus,
    accessToken?: string,
  ): Promise<TrackerListEntry> {
    const data = await this.runGraphQL<{
      SaveMediaListEntry?: RawListEntry | null;
    }>(
      SAVE_PROGRESS,
      {
        mediaId: toIntId(mediaId),
        progress,
        status: toAniListStatus(status),
      },
      accessToken,
    );
    if (!data.SaveMediaListEntry) {
      throw new TrackerError("graphql");
    }
    return mapListEntry(data.SaveMediaListEntry);
  }

  private async runGraphQL<T>(
    document: string,
    variables?: Record<string, unknown>,
    accessToken = this.options.accessToken,
  ): Promise<T> {
    try {
      return (await this.transport.request(
        document,
        variables,
        accessToken,
      )) as T;
    } catch (cause) {
      throw new TrackerError(
        isGraphQLResponseError(cause) ? "graphql" : "transport",
        cause,
      );
    }
  }
}

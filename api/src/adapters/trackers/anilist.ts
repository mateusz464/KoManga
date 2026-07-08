import type {
  Tracker,
  TrackerListEntry,
  TrackerMediaCandidate,
  TrackerStatus,
  TrackerToken,
} from "../../services/ports/tracker.js";
import { TrackerError } from "../../services/ports/tracker.js";
import { GraphQLClient } from "graphql-request";

const GRAPHQL_ENDPOINT = "https://graphql.anilist.co";
const TOKEN_ENDPOINT = "https://anilist.co/api/v2/oauth/token";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 100;

const SEARCH_MEDIA = /* GraphQL */ `
  query SearchMedia($search: String!) {
    Page(perPage: 10) {
      media(search: $search, type: MANGA, format_not: NOVEL) {
        id
        title {
          romaji
          english
          native
        }
        synonyms
        coverImage {
          large
        }
      }
    }
  }
`;

const GET_LIST_ENTRY = /* GraphQL */ `
  query GetListEntry($mediaId: Int!) {
    MediaList(mediaId: $mediaId) {
      progress
      status
    }
  }
`;

const SAVE_PROGRESS = /* GraphQL */ `
  mutation SaveProgress(
    $mediaId: Int!
    $progress: Int!
    $status: MediaListStatus!
  ) {
    SaveMediaListEntry(
      mediaId: $mediaId
      progress: $progress
      status: $status
    ) {
      progress
      status
    }
  }
`;

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

  async searchMedia(title: string): Promise<TrackerMediaCandidate[]> {
    const data = await this.runGraphQL<{ Page?: { media?: RawMedia[] } }>(
      SEARCH_MEDIA,
      { search: title },
    );
    return (data.Page?.media ?? []).map(mapMediaCandidate);
  }

  async getListEntry(mediaId: string): Promise<TrackerListEntry | null> {
    const data = await this.runGraphQL<{ MediaList?: RawListEntry | null }>(
      GET_LIST_ENTRY,
      { mediaId: toIntId(mediaId) },
    );
    return data.MediaList ? mapListEntry(data.MediaList) : null;
  }

  async saveProgress(
    mediaId: string,
    progress: number,
    status: TrackerStatus,
  ): Promise<TrackerListEntry> {
    const data = await this.runGraphQL<{
      SaveMediaListEntry?: RawListEntry | null;
    }>(SAVE_PROGRESS, {
      mediaId: toIntId(mediaId),
      progress,
      status: toAniListStatus(status),
    });
    if (!data.SaveMediaListEntry) {
      throw new TrackerError("graphql");
    }
    return mapListEntry(data.SaveMediaListEntry);
  }

  private async runGraphQL<T>(
    document: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    try {
      return (await this.transport.request(
        document,
        variables,
        this.options.accessToken,
      )) as T;
    } catch (cause) {
      throw new TrackerError(
        isGraphQLResponseError(cause) ? "graphql" : "transport",
        cause,
      );
    }
  }
}

export interface AniListHttpTransportOptions {
  readonly graphqlEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly timeoutMs?: number;
  readonly retries?: number;
}

export class AniListHttpTransport implements AniListTransport {
  private readonly client: GraphQLClient;
  private readonly tokenEndpoint: string;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(options: AniListHttpTransportOptions = {}) {
    this.client = new GraphQLClient(
      options.graphqlEndpoint ?? GRAPHQL_ENDPOINT,
    );
    this.tokenEndpoint = options.tokenEndpoint ?? TOKEN_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
  }

  async request(
    document: string,
    variables?: Record<string, unknown>,
    accessToken?: string,
  ): Promise<unknown> {
    return this.withRetry((signal) =>
      this.client.request({
        document,
        variables,
        requestHeaders: accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined,
        signal,
      }),
    );
  }

  async postToken(request: AniListTokenRequest): Promise<unknown> {
    return this.withRetry(async (signal) => {
      const response = await fetch(this.tokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(request),
        signal,
      });
      const data = (await response.json().catch(() => undefined)) as unknown;
      if (!response.ok) {
        throw new Error(
          `AniList token exchange failed with ${response.status}`,
        );
      }
      return data;
    });
  }

  private async withRetry<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        return await operation(controller.signal);
      } catch (error) {
        lastError = error;
        if (isGraphQLResponseError(error) || attempt === this.retries) {
          throw error;
        }
        await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }
}

interface RawMedia {
  readonly id?: unknown;
  readonly title?: {
    readonly romaji?: unknown;
    readonly english?: unknown;
    readonly native?: unknown;
  };
  readonly synonyms?: unknown;
  readonly coverImage?: {
    readonly large?: unknown;
  };
}

interface RawListEntry {
  readonly progress?: unknown;
  readonly status?: unknown;
}

interface RawToken {
  readonly access_token?: unknown;
  readonly token_type?: unknown;
  readonly expires_in?: unknown;
  readonly refresh_token?: unknown;
}

function mapToken(data: unknown): TrackerToken {
  const token = data as RawToken;
  if (
    typeof token.access_token !== "string" ||
    typeof token.token_type !== "string"
  ) {
    throw new TrackerError("token_exchange");
  }
  return {
    accessToken: token.access_token,
    tokenType: token.token_type,
    ...(typeof token.expires_in === "number"
      ? { expiresAt: new Date(Date.now() + token.expires_in * 1000) }
      : {}),
    ...(typeof token.refresh_token === "string"
      ? { refreshToken: token.refresh_token }
      : {}),
  };
}

function mapMediaCandidate(media: RawMedia): TrackerMediaCandidate {
  const title = firstString(media.title?.romaji, media.title?.english) ?? "";
  return {
    mediaId: String(media.id),
    title,
    alternateTitles: [
      ...strings(media.title?.english, media.title?.native),
      ...arrayStrings(media.synonyms),
    ],
    ...(typeof media.coverImage?.large === "string"
      ? { coverImageUrl: media.coverImage.large }
      : {}),
  };
}

function mapListEntry(entry: RawListEntry): TrackerListEntry {
  return {
    progress: typeof entry.progress === "number" ? entry.progress : 0,
    status: fromAniListStatus(entry.status),
  };
}

function toAniListStatus(status: TrackerStatus): string {
  switch (status) {
    case "reading":
      return "CURRENT";
    case "planning":
      return "PLANNING";
    case "completed":
      return "COMPLETED";
    case "paused":
      return "PAUSED";
    case "dropped":
      return "DROPPED";
    case "rereading":
      return "REPEATING";
  }
}

function fromAniListStatus(status: unknown): TrackerStatus {
  switch (status) {
    case "CURRENT":
      return "reading";
    case "PLANNING":
      return "planning";
    case "COMPLETED":
      return "completed";
    case "PAUSED":
      return "paused";
    case "DROPPED":
      return "dropped";
    case "REPEATING":
      return "rereading";
    default:
      throw new TrackerError("graphql");
  }
}

function toIntId(id: string): number {
  const parsed = Number(id);
  if (!Number.isInteger(parsed)) {
    throw new TrackerError("graphql");
  }
  return parsed;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}

function strings(...values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === "string");
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isGraphQLResponseError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as { response?: unknown }).response === "object"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createAniListTracker(
  options: AniListTrackerOptions,
): AniListTracker {
  return new AniListTracker(new AniListHttpTransport(), options);
}

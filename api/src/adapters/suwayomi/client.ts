import { NotFoundError } from "../../http/errors.js";
import {
  SuwayomiError,
  type Chapter,
  type MangaDetails,
  type MangaSummary,
  type PageRef,
  type RawPage,
  type SearchParams,
  type SearchResult,
  type Source,
  type SuwayomiClient,
} from "../../services/ports/suwayomi-client.js";
import { GraphQLRequestTransport, type GraphQLTransport } from "./transport.js";

// Suwayomi serves GraphQL under this fixed path; the base URL from config points
// at the server root. Keeping the path here (CLAUDE.md §13) means a Suwayomi
// endpoint change touches only this adapter.
const GRAPHQL_PATH = "/api/graphql";

const LIST_SOURCES = /* GraphQL */ `
  query ListSources {
    sources {
      nodes {
        id
        displayName
        lang
        iconUrl
      }
    }
  }
`;

// Search is a mutation (it triggers a live source fetch) and `type` is required.
const SEARCH = /* GraphQL */ `
  mutation Search($source: LongString!, $query: String!, $page: Int!) {
    fetchSourceManga(
      input: { type: SEARCH, source: $source, query: $query, page: $page }
    ) {
      mangas {
        id
        title
        thumbnailUrl
      }
      hasNextPage
    }
  }
`;

const MANGA_DETAILS = /* GraphQL */ `
  query MangaDetails($id: Int!) {
    manga(id: $id) {
      id
      sourceId
      title
      author
      artist
      description
      thumbnailUrl
      status
      genres: genre
    }
  }
`;

const LIST_CHAPTERS = /* GraphQL */ `
  query ListChapters($id: Int!) {
    manga(id: $id) {
      chapters {
        nodes {
          id
          name
          chapterNumber
          scanlator
          uploadDate
          pageCount
        }
      }
    }
  }
`;

// Page URLs come from this mutation, not from a field on the chapter.
const FETCH_CHAPTER_PAGES = /* GraphQL */ `
  mutation ChapterPages($chapterId: Int!) {
    fetchChapterPages(input: { chapterId: $chapterId }) {
      pages
    }
  }
`;

interface RawSource {
  id: unknown;
  displayName?: unknown;
  name?: unknown;
  lang?: unknown;
  iconUrl?: unknown;
}

interface RawMangaSummary {
  id: unknown;
  title?: unknown;
  thumbnailUrl?: unknown;
}

interface RawMangaDetails extends RawMangaSummary {
  sourceId?: unknown;
  author?: unknown;
  artist?: unknown;
  description?: unknown;
  status?: unknown;
  genres?: unknown;
}

interface RawChapter {
  id: unknown;
  name?: unknown;
  chapterNumber?: unknown;
  scanlator?: unknown;
  uploadDate?: unknown;
  pageCount?: unknown;
}

export interface SuwayomiClientOptions {
  readonly baseUrl?: string;
  readonly fetchBytes?: (url: string) => Promise<RawPage>;
}

export class SuwayomiGraphQLClient implements SuwayomiClient {
  private readonly baseUrl?: string;
  private readonly fetchBytes: (url: string) => Promise<RawPage>;

  constructor(
    private readonly transport: GraphQLTransport,
    options: SuwayomiClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl;
    this.fetchBytes = options.fetchBytes ?? defaultFetchBytes;
  }

  async listSources(): Promise<Source[]> {
    const data = await this.run<{ sources?: { nodes?: RawSource[] } }>(
      LIST_SOURCES,
    );
    return (data.sources?.nodes ?? []).map(mapSource);
  }

  async search(params: SearchParams): Promise<SearchResult> {
    const data = await this.run<{
      fetchSourceManga?: { mangas?: RawMangaSummary[]; hasNextPage?: unknown };
    }>(SEARCH, {
      source: params.sourceId,
      query: params.query,
      page: params.page ?? 1,
    });
    const result = data.fetchSourceManga;
    return {
      mangas: (result?.mangas ?? []).map(mapMangaSummary),
      hasNextPage: result?.hasNextPage === true,
    };
  }

  async getMangaDetails(mangaId: string): Promise<MangaDetails> {
    const data = await this.runManga<{ manga?: RawMangaDetails }>(
      MANGA_DETAILS,
      mangaId,
    );
    if (!data.manga) {
      throw new NotFoundError(`Manga ${mangaId} not found`);
    }
    return mapMangaDetails(data.manga);
  }

  async listChapters(mangaId: string): Promise<Chapter[]> {
    const data = await this.runManga<{
      manga?: { chapters?: { nodes?: RawChapter[] } };
    }>(LIST_CHAPTERS, mangaId);
    return (data.manga?.chapters?.nodes ?? []).map(mapChapter);
  }

  async getChapterPageCount(chapterId: string): Promise<number> {
    const pages = await this.fetchPageUrls(chapterId);
    return pages.length;
  }

  async fetchPage(ref: PageRef): Promise<RawPage> {
    const pages = await this.fetchPageUrls(ref.chapterId);
    const url = pages[ref.pageIndex];
    if (typeof url !== "string") {
      throw new SuwayomiError();
    }
    return this.fetchBytes(this.resolveUrl(url));
  }

  // The `fetchChapterPages` mutation is the single source of a chapter's pages;
  // both the page count and individual page fetches derive from its `pages`
  // array, so the GraphQL coupling lives in one place (CLAUDE.md §13).
  private async fetchPageUrls(chapterId: string): Promise<unknown[]> {
    const data = await this.run<{
      fetchChapterPages?: { pages?: unknown };
    }>(FETCH_CHAPTER_PAGES, { chapterId: toIntId(chapterId) });
    return Array.isArray(data.fetchChapterPages?.pages)
      ? (data.fetchChapterPages.pages as unknown[])
      : [];
  }

  private async run<T>(
    document: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    try {
      return (await this.transport.request(document, variables)) as T;
    } catch (cause) {
      throw new SuwayomiError(undefined, cause);
    }
  }

  // Queries rooted at the non-null `manga(id:)` field: an unknown id surfaces as
  // a GraphQL non-null violation on the `manga` path, which we map to a 404
  // rather than the generic 502 (verified against live Suwayomi, API-306).
  private async runManga<T>(document: string, mangaId: string): Promise<T> {
    try {
      return (await this.transport.request(document, {
        id: toIntId(mangaId),
      })) as T;
    } catch (cause) {
      if (isMangaNotFound(cause)) {
        throw new NotFoundError(`Manga ${mangaId} not found`);
      }
      throw new SuwayomiError(undefined, cause);
    }
  }

  private resolveUrl(url: string): string {
    if (/^https?:\/\//.test(url) || !this.baseUrl) {
      return url;
    }
    return new URL(url, this.baseUrl).toString();
  }
}

export interface SuwayomiConnectionOptions {
  /** Suwayomi server root, e.g. `http://suwayomi:4567` (no GraphQL path). */
  readonly baseUrl: string;
  readonly authToken?: string;
  readonly timeoutMs?: number;
  readonly retries?: number;
}

/**
 * Builds a ready-to-use client from a single base URL: the GraphQL transport
 * targets `${baseUrl}/api/graphql`, while the client keeps `baseUrl` to resolve
 * relative page/image URLs Suwayomi returns. This is the only place that knows
 * how a Suwayomi base URL maps to its endpoints.
 */
export function createSuwayomiClient(
  options: SuwayomiConnectionOptions,
): SuwayomiGraphQLClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const transport = new GraphQLRequestTransport({
    endpoint: `${baseUrl}${GRAPHQL_PATH}`,
    ...(options.authToken !== undefined ? { authToken: options.authToken } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.retries !== undefined ? { retries: options.retries } : {}),
  });
  return new SuwayomiGraphQLClient(transport, { baseUrl });
}

// Domain ids are strings; Suwayomi keys manga/chapter by Int.
function toIntId(id: string): number {
  return Number(id);
}

interface RawGraphQLError {
  message?: unknown;
  path?: unknown;
}

// `graphql-request` attaches the GraphQL response (with its `errors`) to the
// thrown error. A missing manga is signalled as a non-null violation on the
// `manga` path — the only "not found" channel Suwayomi gives us for `manga(id:)`.
function isMangaNotFound(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null || !("response" in cause)) {
    return false;
  }
  const response = (cause as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) {
    return false;
  }
  const errors = (response as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return false;
  }
  return errors.some((error: RawGraphQLError) => {
    const onMangaPath =
      Array.isArray(error?.path) && error.path.includes("manga");
    const isNullViolation = /null/i.test(String(error?.message ?? ""));
    return onMangaPath && isNullViolation;
  });
}

function mapSource(node: RawSource): Source {
  return {
    id: String(node.id),
    name: String(node.displayName ?? node.name ?? ""),
    lang: String(node.lang ?? ""),
    ...(node.iconUrl != null ? { iconUrl: String(node.iconUrl) } : {}),
  };
}

function mapMangaSummary(node: RawMangaSummary): MangaSummary {
  return {
    id: String(node.id),
    title: String(node.title ?? ""),
    ...(node.thumbnailUrl != null
      ? { thumbnailUrl: String(node.thumbnailUrl) }
      : {}),
  };
}

function mapMangaDetails(node: RawMangaDetails): MangaDetails {
  return {
    id: String(node.id),
    sourceId: String(node.sourceId ?? ""),
    title: String(node.title ?? ""),
    genres: Array.isArray(node.genres) ? node.genres.map(String) : [],
    ...(node.author != null ? { author: String(node.author) } : {}),
    ...(node.artist != null ? { artist: String(node.artist) } : {}),
    ...(node.description != null
      ? { description: String(node.description) }
      : {}),
    ...(node.thumbnailUrl != null
      ? { thumbnailUrl: String(node.thumbnailUrl) }
      : {}),
    ...(node.status != null ? { status: String(node.status) } : {}),
  };
}

function mapChapter(node: RawChapter): Chapter {
  return {
    id: String(node.id),
    name: String(node.name ?? ""),
    chapterNumber: Number(node.chapterNumber ?? 0),
    ...(node.scanlator != null ? { scanlator: String(node.scanlator) } : {}),
    ...(node.uploadDate != null ? { uploadedAt: Number(node.uploadDate) } : {}),
    ...(node.pageCount != null ? { pageCount: Number(node.pageCount) } : {}),
  };
}

async function defaultFetchBytes(url: string): Promise<RawPage> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new SuwayomiError(undefined, cause);
  }
  if (!response.ok) {
    throw new SuwayomiError(undefined, `page fetch failed: ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    bytes,
    contentType:
      response.headers.get("content-type") ?? "application/octet-stream",
  };
}

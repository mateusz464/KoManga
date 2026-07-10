import { NotFoundError } from "../../http/errors.js";
import {
  SuwayomiError,
  type Chapter,
  type ChapterDetails,
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

// Suwayomi serves GraphQL here; config's base URL points at the server root.
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

const CHAPTER_DETAILS = /* GraphQL */ `
  query ChapterDetails($id: Int!) {
    chapter(id: $id) {
      id
      name
      chapterNumber
      scanlator
      uploadDate
      pageCount
      mangaId
    }
  }
`;

// Scrapes the source for the manga's chapters and returns the populated list.
// A query of `manga.chapters.nodes` (LIST_CHAPTERS) only reads what Suwayomi
// has already stored; this mutation is what actually fetches from the source,
// so a freshly-searched manga gets its chapters here (API-904).
const FETCH_CHAPTERS = /* GraphQL */ `
  mutation FetchChapters($mangaId: Int!) {
    fetchChapters(input: { mangaId: $mangaId }) {
      chapters {
        id
        name
        chapterNumber
        scanlator
        uploadDate
        pageCount
      }
    }
  }
`;

// The cover's source URL lives on the manga itself; rooted at `manga(id:)` so an
// unknown id surfaces the same non-null violation `runManga` maps to NotFoundError.
const MANGA_THUMBNAIL = /* GraphQL */ `
  query MangaThumbnail($id: Int!) {
    manga(id: $id) {
      thumbnailUrl
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

interface RawChapterDetails extends RawChapter {
  mangaId?: unknown;
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

  // Rooted at the non-null `chapter(id:)` field: like `manga(id:)`, an unknown
  // id surfaces as a non-null violation on the `chapter` path, mapped to 404
  // not 502 (live, KOM-144).
  async getChapterDetails(chapterId: string): Promise<ChapterDetails> {
    let data: { chapter?: RawChapterDetails };
    try {
      data = (await this.transport.request(CHAPTER_DETAILS, {
        id: toIntId(chapterId),
      })) as { chapter?: RawChapterDetails };
    } catch (cause) {
      if (isNotFoundOnPath(cause, "chapter")) {
        throw new NotFoundError(`Chapter ${chapterId} not found`);
      }
      throw new SuwayomiError(undefined, cause);
    }
    if (!data.chapter) {
      throw new NotFoundError(`Chapter ${chapterId} not found`);
    }
    return {
      ...mapChapter(data.chapter),
      mangaId: String(data.chapter.mangaId ?? ""),
    };
  }

  // Triggers Suwayomi's source scrape and returns the resulting chapters. A
  // source that genuinely has none answers with a "No chapters found" GraphQL
  // error — mapped to an empty list, not a 5xx (consistent with API-306's
  // not-found handling). An unknown manga id still maps to NotFoundError.
  async fetchChapters(mangaId: string): Promise<Chapter[]> {
    let data: { fetchChapters?: { chapters?: RawChapter[] } };
    try {
      data = (await this.transport.request(FETCH_CHAPTERS, {
        mangaId: toIntId(mangaId),
      })) as { fetchChapters?: { chapters?: RawChapter[] } };
    } catch (cause) {
      if (isNoChaptersFound(cause)) {
        return [];
      }
      if (isMangaNotFound(cause)) {
        throw new NotFoundError(`Manga ${mangaId} not found`);
      }
      throw new SuwayomiError(undefined, cause);
    }
    return (data.fetchChapters?.chapters ?? []).map(mapChapter);
  }

  async getChapterPageCount(chapterId: string): Promise<number> {
    const pages = await this.fetchPageUrls(chapterId);
    return pages.length;
  }

  async fetchPageUrls(chapterId: string): Promise<string[]> {
    const pages = await this.fetchRawPageUrls(chapterId);
    return pages.map((url) => {
      if (typeof url !== "string") {
        throw new SuwayomiError();
      }
      return this.resolveUrl(url);
    });
  }

  fetchPageBytes(url: string): Promise<RawPage> {
    return this.fetchBytes(url);
  }

  async fetchPage(ref: PageRef): Promise<RawPage> {
    const urls = await this.fetchPageUrls(ref.chapterId);
    const url = urls[ref.pageIndex];
    if (url === undefined) {
      throw new SuwayomiError();
    }
    return this.fetchBytes(url);
  }

  // Resolves the manga's cover the same way as a page: read its (Suwayomi-
  // internal) thumbnail URL, then fetch the bytes server-side so clients never
  // see the raw URL (RFC §6). Unknown manga → NotFoundError (via runManga);
  // a manga with no cover is also treated as not found rather than a 5xx.
  async fetchCover(mangaId: string): Promise<RawPage> {
    const data = await this.runManga<{ manga?: { thumbnailUrl?: unknown } }>(
      MANGA_THUMBNAIL,
      mangaId,
    );
    const url = data.manga?.thumbnailUrl;
    if (typeof url !== "string" || url.length === 0) {
      throw new NotFoundError(`Cover for manga ${mangaId} not found`);
    }
    return this.fetchBytes(this.resolveUrl(url));
  }

  // Single source of a chapter's pages — count, URL list and individual fetches
  // all derive from its `pages` array (CLAUDE.md §13). An unknown chapter comes
  // back as a "Collection is empty." error, mapped to 404 not 502 (live, API-402).
  private async fetchRawPageUrls(chapterId: string): Promise<unknown[]> {
    let data: { fetchChapterPages?: { pages?: unknown } };
    try {
      data = (await this.transport.request(FETCH_CHAPTER_PAGES, {
        chapterId: toIntId(chapterId),
      })) as { fetchChapterPages?: { pages?: unknown } };
    } catch (cause) {
      if (isChapterNotFound(cause)) {
        throw new NotFoundError(`Chapter ${chapterId} not found`);
      }
      throw new SuwayomiError(undefined, cause);
    }
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
  // a non-null violation on the `manga` path, mapped to 404 not 502 (live, API-306).
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

// Transport targets `${baseUrl}/api/graphql`; the client keeps `baseUrl` to
// resolve the relative page/image URLs Suwayomi returns.
export function createSuwayomiClient(
  options: SuwayomiConnectionOptions,
): SuwayomiGraphQLClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const transport = new GraphQLRequestTransport({
    endpoint: `${baseUrl}${GRAPHQL_PATH}`,
    ...(options.authToken !== undefined
      ? { authToken: options.authToken }
      : {}),
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
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

function responseErrors(cause: unknown): RawGraphQLError[] {
  if (typeof cause !== "object" || cause === null || !("response" in cause)) {
    return [];
  }
  const response = (cause as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) {
    return [];
  }
  const errors = (response as { errors?: unknown }).errors;
  return Array.isArray(errors) ? (errors as RawGraphQLError[]) : [];
}

// A missing manga/chapter is signalled as a non-null violation on that field's
// path — the only "not found" channel Suwayomi gives for `manga(id:)` and
// `chapter(id:)`.
function isNotFoundOnPath(cause: unknown, path: string): boolean {
  return responseErrors(cause).some((error) => {
    const onPath = Array.isArray(error?.path) && error.path.includes(path);
    const isNullViolation = /null/i.test(String(error?.message ?? ""));
    return onPath && isNullViolation;
  });
}

function isMangaNotFound(cause: unknown): boolean {
  return isNotFoundOnPath(cause, "manga");
}

// An unknown chapter on `fetchChapterPages` comes back as a "Collection is
// empty." error — the only signal Suwayomi gives for a missing chapter here.
function isChapterNotFound(cause: unknown): boolean {
  return responseErrors(cause).some((error) =>
    /collection is empty/i.test(String(error?.message ?? "")),
  );
}

// A source with no chapters surfaces as a "No chapters found" GraphQL error on
// the `fetchChapters` mutation — the signal to map to an empty list rather than
// a 5xx (API-904). Empty payloads are handled separately by the caller.
function isNoChaptersFound(cause: unknown): boolean {
  return responseErrors(cause).some((error) =>
    /no chapters found/i.test(String(error?.message ?? "")),
  );
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

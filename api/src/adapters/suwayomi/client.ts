// graphql-request adapter implementing the SuwayomiClient port (API-202). All
// Suwayomi GraphQL coupling lives here: the documents below and the mapping from
// raw response shapes to domain types. Every method runs through `run()`, which
// normalises any transport rejection (GraphQL error, timeout, network failure)
// into a single typed SuwayomiError so the underlying reason never reaches the
// caller (CLAUDE.md §6, §13).

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
import type { GraphQLTransport } from "./transport.js";

// --- GraphQL documents (the only place that knows Suwayomi's schema) ---------

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

const SEARCH = /* GraphQL */ `
  query Search($source: LongString!, $query: String!, $page: Int!) {
    fetchSourceManga(input: { source: $source, query: $query, page: $page }) {
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
  query MangaDetails($id: String!) {
    manga(id: $id) {
      id
      sourceId
      title
      author
      artist
      description
      thumbnailUrl
      status
      genres
    }
  }
`;

const LIST_CHAPTERS = /* GraphQL */ `
  query ListChapters($id: String!) {
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

const FETCH_CHAPTER_PAGES = /* GraphQL */ `
  query ChapterPages($chapterId: String!) {
    chapter(id: $chapterId) {
      pageCount
      pages
    }
  }
`;

// --- Raw response shapes (graphql-request returns `unknown`) ------------------

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

/** Optional second argument; absent in the contract tests (transport-only). */
export interface SuwayomiClientOptions {
  /** Absolute base URL of the Suwayomi server, used to resolve page image URLs. */
  readonly baseUrl?: string;
  /** Fetches raw bytes for an absolute URL. Injectable; defaults to global fetch. */
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
    const data = await this.run<{ manga?: RawMangaDetails }>(MANGA_DETAILS, {
      id: mangaId,
    });
    if (!data.manga) {
      throw new SuwayomiError();
    }
    return mapMangaDetails(data.manga);
  }

  async listChapters(mangaId: string): Promise<Chapter[]> {
    const data = await this.run<{
      manga?: { chapters?: { nodes?: RawChapter[] } };
    }>(LIST_CHAPTERS, { id: mangaId });
    return (data.manga?.chapters?.nodes ?? []).map(mapChapter);
  }

  async fetchPage(ref: PageRef): Promise<RawPage> {
    const data = await this.run<{
      chapter?: { pages?: unknown };
    }>(FETCH_CHAPTER_PAGES, { chapterId: ref.chapterId });
    const pages = Array.isArray(data.chapter?.pages)
      ? (data.chapter.pages as unknown[])
      : [];
    const url = pages[ref.pageIndex];
    if (typeof url !== "string") {
      throw new SuwayomiError();
    }
    return this.fetchBytes(this.resolveUrl(url));
  }

  /**
   * Run a GraphQL document through the transport, normalising any rejection into
   * a typed SuwayomiError. The original cause is attached for server-side
   * logging only and never reaches the client (CLAUDE.md §6).
   */
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

  private resolveUrl(url: string): string {
    if (/^https?:\/\//.test(url) || !this.baseUrl) {
      return url;
    }
    return new URL(url, this.baseUrl).toString();
  }
}

// --- Mapping (raw → domain). IDs are normalised to strings (CLAUDE.md §11) ---

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

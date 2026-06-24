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
    const data = await this.run<{ manga?: RawMangaDetails }>(MANGA_DETAILS, {
      id: toIntId(mangaId),
    });
    if (!data.manga) {
      throw new SuwayomiError();
    }
    return mapMangaDetails(data.manga);
  }

  async listChapters(mangaId: string): Promise<Chapter[]> {
    const data = await this.run<{
      manga?: { chapters?: { nodes?: RawChapter[] } };
    }>(LIST_CHAPTERS, { id: toIntId(mangaId) });
    return (data.manga?.chapters?.nodes ?? []).map(mapChapter);
  }

  async fetchPage(ref: PageRef): Promise<RawPage> {
    const data = await this.run<{
      fetchChapterPages?: { pages?: unknown };
    }>(FETCH_CHAPTER_PAGES, { chapterId: toIntId(ref.chapterId) });
    const pages = Array.isArray(data.fetchChapterPages?.pages)
      ? (data.fetchChapterPages.pages as unknown[])
      : [];
    const url = pages[ref.pageIndex];
    if (typeof url !== "string") {
      throw new SuwayomiError();
    }
    return this.fetchBytes(this.resolveUrl(url));
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

  private resolveUrl(url: string): string {
    if (/^https?:\/\//.test(url) || !this.baseUrl) {
      return url;
    }
    return new URL(url, this.baseUrl).toString();
  }
}

// Domain ids are strings; Suwayomi keys manga/chapter by Int.
function toIntId(id: string): number {
  return Number(id);
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

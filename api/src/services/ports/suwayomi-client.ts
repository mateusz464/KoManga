import { ApiError } from "../../http/errors.js";

export interface Source {
  readonly id: string;
  readonly name: string;
  readonly lang: string;
  readonly iconUrl?: string;
}

export interface MangaSummary {
  readonly id: string;
  readonly title: string;
  readonly thumbnailUrl?: string;
}

export interface SearchResult {
  readonly mangas: readonly MangaSummary[];
  readonly hasNextPage: boolean;
}

export interface MangaDetails {
  readonly id: string;
  readonly sourceId: string;
  readonly title: string;
  readonly author?: string;
  readonly artist?: string;
  readonly description?: string;
  readonly thumbnailUrl?: string;
  readonly status?: string;
  readonly genres: readonly string[];
}

export interface Chapter {
  readonly id: string;
  readonly name: string;
  readonly chapterNumber: number;
  readonly scanlator?: string;
  readonly uploadedAt?: number;
  readonly pageCount?: number;
}

export interface RawPage {
  readonly bytes: Buffer;
  readonly contentType: string;
}

export interface SearchParams {
  readonly sourceId: string;
  readonly query: string;
  /** 1-based page number for paginated sources. Defaults to the first page. */
  readonly page?: number;
}

export interface PageRef {
  readonly chapterId: string;
  /** 0-based index of the page within the chapter. */
  readonly pageIndex: number;
}

/**
 * Every method either resolves with domain values or rejects with a
 * {@link SuwayomiError} — upstream GraphQL errors, timeouts and network failures
 * are all normalised to that single typed error.
 */
export interface SuwayomiClient {
  listSources(): Promise<Source[]>;
  search(params: SearchParams): Promise<SearchResult>;
  getMangaDetails(mangaId: string): Promise<MangaDetails>;
  listChapters(mangaId: string): Promise<Chapter[]>;
  /**
   * Triggers Suwayomi's source chapter-fetch (the scrape) and resolves with the
   * resulting chapters. Unlike {@link listChapters}, which only reads whatever
   * Suwayomi has already stored, this populates them from the source — so a
   * freshly-searched manga returns its chapters on first open. A source that
   * genuinely has none resolves to `[]`, not an error.
   */
  fetchChapters(mangaId: string): Promise<Chapter[]>;
  /** Page count only (no image data); rejects {@link NotFoundError} on unknown id. */
  getChapterPageCount(chapterId: string): Promise<number>;
  /**
   * Resolves a chapter's page image URLs in a single upstream call, in reading
   * order. Building a CBZ needs every page, so callers resolve the list once
   * here and fetch each via {@link fetchPageBytes} — avoiding the N+1 that
   * per-page {@link fetchPage} triggers across a whole chapter (each of those
   * re-runs Suwayomi's page resolution). Rejects {@link NotFoundError} on an
   * unknown chapter, {@link SuwayomiError} on upstream failure.
   */
  fetchPageUrls(chapterId: string): Promise<string[]>;
  /** Fetches the image bytes for a page URL returned by {@link fetchPageUrls}. */
  fetchPageBytes(url: string): Promise<RawPage>;
  fetchPage(ref: PageRef): Promise<RawPage>;
  /**
   * Fetches the manga's cover image bytes from Suwayomi. Mirrors
   * {@link fetchPage} — the raw thumbnail (a Suwayomi-internal URL clients can't
   * reach) is resolved server-side so covers can be served through the same
   * profile-negotiated, cached image path as chapter pages (RFC §6). Unknown
   * manga rejects {@link NotFoundError}; upstream failures reject
   * {@link SuwayomiError}.
   */
  fetchCover(mangaId: string): Promise<RawPage>;
}

/**
 * Maps to `502 Bad Gateway`. The client-facing `message` is deliberately
 * generic; the underlying reason is attached as `cause` for server-side logging
 * only and is never surfaced to clients (CLAUDE.md §6).
 */
export class SuwayomiError extends ApiError {
  constructor(message = "Upstream Suwayomi request failed", cause?: unknown) {
    super(message, 502, "SUWAYOMI_ERROR");
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

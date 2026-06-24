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
  fetchPage(ref: PageRef): Promise<RawPage>;
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

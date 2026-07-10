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

export interface ChapterDetails extends Chapter {
  readonly mangaId: string;
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

// Every method resolves with domain values or rejects with a {@link SuwayomiError}:
// upstream GraphQL errors, timeouts and network failures all normalise to it.
export interface SuwayomiClient {
  listSources(): Promise<Source[]>;
  search(params: SearchParams): Promise<SearchResult>;
  getMangaDetails(mangaId: string): Promise<MangaDetails>;
  listChapters(mangaId: string): Promise<Chapter[]>;
  getChapterDetails(chapterId: string): Promise<ChapterDetails>;
  // Triggers Suwayomi's source scrape and returns the resulting chapters; unlike
  // listChapters (which only reads what Suwayomi has already stored) this
  // populates them from the source, so a freshly-searched manga returns chapters
  // on first open. No chapters resolves to `[]`, not an error.
  fetchChapters(mangaId: string): Promise<Chapter[]>;
  getChapterPageCount(chapterId: string): Promise<number>;
  // Resolves a chapter's page image URLs in one upstream call, in reading order,
  // so a CBZ build resolves once here and fetches each via fetchPageBytes rather
  // than re-running per-page resolution (the N+1 that fetchPage would trigger).
  fetchPageUrls(chapterId: string): Promise<string[]>;
  fetchPageBytes(url: string): Promise<RawPage>;
  fetchPage(ref: PageRef): Promise<RawPage>;
  fetchCover(mangaId: string): Promise<RawPage>;
}

// Maps to 502. The client-facing message stays generic; the real reason rides on
// `cause` for server-side logging only, never surfaced to clients (CLAUDE.md §6).
export class SuwayomiError extends ApiError {
  constructor(message = "Upstream Suwayomi request failed", cause?: unknown) {
    super(message, 502, "SUWAYOMI_ERROR");
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

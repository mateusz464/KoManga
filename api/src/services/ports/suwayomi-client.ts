// Port (CLAUDE.md §3): the interface the rest of the API uses to talk to
// Suwayomi. Services depend on this abstraction; the graphql-request adapter in
// adapters/suwayomi implements it (API-202). All Suwayomi coupling lives behind
// this boundary, so a GraphQL schema change breaks one module, not the app
// (CLAUDE.md §13). No graphql-request / Suwayomi types cross this boundary — the
// adapter maps them to the domain types below (CLAUDE.md §11).

import { ApiError } from "../../http/errors.js";

/** A content source/extension installed in Suwayomi (e.g. MangaDex). */
export interface Source {
  readonly id: string;
  readonly name: string;
  readonly lang: string;
  readonly iconUrl?: string;
}

/** A lightweight manga entry as returned by source browsing/search. */
export interface MangaSummary {
  readonly id: string;
  readonly title: string;
  readonly thumbnailUrl?: string;
}

/** A page of search results plus whether more pages exist. */
export interface SearchResult {
  readonly mangas: readonly MangaSummary[];
  readonly hasNextPage: boolean;
}

/** Full metadata for a single manga. */
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

/** A single chapter belonging to a manga. */
export interface Chapter {
  readonly id: string;
  readonly name: string;
  readonly chapterNumber: number;
  readonly scanlator?: string;
  readonly uploadedAt?: number;
  readonly pageCount?: number;
}

/** The raw bytes of a single page image, with its source content type. */
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
 * The Suwayomi client port. Every method either resolves with domain values or
 * rejects with a {@link SuwayomiError} — upstream GraphQL errors, timeouts and
 * network failures are normalised to that single typed error so callers never
 * see graphql-request / transport details (CLAUDE.md §6, §11).
 */
export interface SuwayomiClient {
  /** List the sources currently installed in Suwayomi. */
  listSources(): Promise<Source[]>;

  /** Search a single source for manga matching a query. */
  search(params: SearchParams): Promise<SearchResult>;

  /** Fetch full metadata for one manga. */
  getMangaDetails(mangaId: string): Promise<MangaDetails>;

  /** List the chapters of one manga, in source order. */
  listChapters(mangaId: string): Promise<Chapter[]>;

  /** Fetch the raw image bytes of a single page. */
  fetchPage(ref: PageRef): Promise<RawPage>;
}

/**
 * Typed domain error for any failure talking to Suwayomi (GraphQL error,
 * timeout, or transport/network failure). Maps to `502 Bad Gateway` via the
 * central error middleware. The client-facing `message` is deliberately
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

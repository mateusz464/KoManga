// The client's single entry point for network access (CLAUDE.md §5): one typed
// method per REST endpoint, mapped from the API's `{ data }` envelope.

import { HttpClient } from "./http.js";
import { encodeToken } from "./url.js";
import type {
  ChapterPages,
  DownloadRecord,
  LibraryEntry,
  MangaView,
  ReadingProgress,
  SearchQuery,
  SearchResult,
  Source,
} from "./types.js";

export interface ApiClientOptions {
  readonly baseUrl?: string;
  readonly getToken?: () => string | null;
}

export class ApiClient {
  private readonly http: HttpClient;

  constructor(options: ApiClientOptions = {}) {
    this.http = new HttpClient(options);
  }

  listSources(): Promise<Source[]> {
    return this.http.request<Source[]>("GET", "/api/sources");
  }

  search(query: SearchQuery): Promise<SearchResult> {
    return this.http.request<SearchResult>("GET", "/api/search", {
      q: query.query,
      source: query.sourceId,
      page: query.page,
    });
  }

  getManga(mangaId: string): Promise<MangaView> {
    return this.http.request<MangaView>(
      "GET",
      "/api/manga/" + encodeToken(mangaId),
    );
  }

  getChapterPages(chapterId: string): Promise<ChapterPages> {
    return this.http.request<ChapterPages>(
      "GET",
      "/api/chapter/" + encodeToken(chapterId) + "/pages",
    );
  }

  // Always `profile=eink`, never `raw` (CLAUDE.md §6). It's an <img> src: no auth.
  pageImageUrl(pageId: string): string {
    return this.http.url("/api/page/" + encodeToken(pageId), {
      profile: "eink",
    });
  }

  downloadCbzUrl(chapterId: string): string {
    return this.http.url("/api/downloads/" + encodeToken(chapterId));
  }

  downloadChapter(chapterId: string, mangaId: string): Promise<DownloadRecord> {
    return this.http.request<DownloadRecord>(
      "POST",
      "/api/chapter/" + encodeToken(chapterId) + "/download",
      { mangaId: mangaId, profile: "eink" },
    );
  }

  listDownloads(): Promise<DownloadRecord[]> {
    return this.http.request<DownloadRecord[]>("GET", "/api/downloads");
  }

  getProgress(mangaId: string): Promise<ReadingProgress> {
    return this.http.request<ReadingProgress>(
      "GET",
      "/api/progress/" + encodeToken(mangaId),
    );
  }

  saveProgress(progress: ReadingProgress): Promise<ReadingProgress> {
    return this.http.request<ReadingProgress>(
      "PUT",
      "/api/progress/" + encodeToken(progress.mangaId),
      undefined,
      {
        chapterId: progress.chapterId,
        page: progress.page,
        updatedAt: progress.updatedAt,
      },
    );
  }

  listLibrary(): Promise<LibraryEntry[]> {
    return this.http.request<LibraryEntry[]>("GET", "/api/library");
  }

  follow(mangaId: string, addedAt: number): Promise<LibraryEntry> {
    return this.http.request<LibraryEntry>(
      "PUT",
      "/api/library/" + encodeToken(mangaId),
      undefined,
      { addedAt: addedAt },
    );
  }

  unfollow(mangaId: string): Promise<void> {
    return this.http.request<void>(
      "DELETE",
      "/api/library/" + encodeToken(mangaId),
    );
  }
}

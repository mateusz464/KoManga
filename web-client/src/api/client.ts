// Red-phase stub for the typed KoManga API client (KWC-301). It pins the public
// surface so the contract tests in `test/api/client.test.ts` compile and run,
// but every method rejects/throws — the real XHR transport, query-string
// building, auth-header injection and error mapping land in KWC-302, which is
// what turns these tests green.
//
// Transport is XHR, not fetch (CLAUDE.md §2 / device spike KWC-102): no `fetch`,
// no `URL`/`URLSearchParams` — query strings are built by hand. All network
// access for the whole client lives behind this module (CLAUDE.md §5).

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
  // Origin/prefix for the API. Defaults to "" — the client is served
  // same-origin by the API (KWC-202), so relative `/api/*` paths suffice.
  readonly baseUrl?: string;
  // Per-request credential provider. Returning a token attaches
  // `Authorization: Bearer <token>`; returning null sends no auth header. Kept
  // as a callback so credential storage (localStorage) stays in the auth flow
  // (KWC-303/304), not baked in here.
  readonly getToken?: () => string | null;
}

const NOT_IMPLEMENTED = "ApiClient is not implemented yet — see KWC-302";

export class ApiClient {
  constructor(private readonly options: ApiClientOptions = {}) {}

  listSources(): Promise<Source[]> {
    return this.notImplemented();
  }

  search(_query: SearchQuery): Promise<SearchResult> {
    return this.notImplemented();
  }

  getManga(_mangaId: string): Promise<MangaView> {
    return this.notImplemented();
  }

  getChapterPages(_chapterId: string): Promise<ChapterPages> {
    return this.notImplemented();
  }

  // Pure URL builder — always pins `profile=eink`; this client never wants
  // `raw` (CLAUDE.md §6). Used as an <img> src, so it carries no auth header.
  pageImageUrl(_pageId: string): string {
    throw new Error(NOT_IMPLEMENTED);
  }

  // Pure URL builder for the stored CBZ of a downloaded chapter.
  downloadCbzUrl(_chapterId: string): string {
    throw new Error(NOT_IMPLEMENTED);
  }

  downloadChapter(
    _chapterId: string,
    _mangaId: string,
  ): Promise<DownloadRecord> {
    return this.notImplemented();
  }

  listDownloads(): Promise<DownloadRecord[]> {
    return this.notImplemented();
  }

  getProgress(_mangaId: string): Promise<ReadingProgress> {
    return this.notImplemented();
  }

  saveProgress(_progress: ReadingProgress): Promise<ReadingProgress> {
    return this.notImplemented();
  }

  listLibrary(): Promise<LibraryEntry[]> {
    return this.notImplemented();
  }

  follow(_mangaId: string, _addedAt: number): Promise<LibraryEntry> {
    return this.notImplemented();
  }

  unfollow(_mangaId: string): Promise<void> {
    return this.notImplemented();
  }

  private notImplemented<T>(): Promise<T> {
    // Touch options so the wiring is exercised; real usage lands in KWC-302.
    void this.options;
    return Promise.reject(new Error(NOT_IMPLEMENTED));
  }
}

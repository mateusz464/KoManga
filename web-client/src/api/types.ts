// Client-domain types for the KoManga REST surface (CLAUDE.md §5, §9). These are
// owned by the client and mapped from the API's `{ data: ... }` envelope in
// `client.ts` — the rest of the app never sees the wire shape. They mirror the
// API epic's contract (RFC §6/§7) but are intentionally re-declared here so a
// future change on either side is a deliberate, visible edit.

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

// Arguments for GET /api/search. `page` is 1-based and omitted for the first page.
export interface SearchQuery {
  readonly sourceId: string;
  readonly query: string;
  readonly page?: number;
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

// Reading direction is API-owned metadata (RFC §6); the reader honours it for
// page order and tap-zone mapping.
export type ReadingDirection = "rtl" | "ltr";

export interface MangaView {
  readonly manga: MangaDetails;
  readonly chapters: readonly Chapter[];
  readonly readingDirection: ReadingDirection;
}

export interface ChapterPages {
  readonly pageCount: number;
  // One id per page, `<chapterId>:<index>` (0-based) — the handle for the
  // page-image URL builder.
  readonly pages: readonly string[];
}

export type DownloadStatus = "pending" | "completed" | "failed";

export interface DownloadRecord {
  readonly chapterId: string;
  readonly mangaId: string;
  readonly cbzPath: string;
  readonly status: DownloadStatus;
  readonly createdAt: number;
}

export interface ReadingProgress {
  readonly mangaId: string;
  readonly chapterId: string;
  readonly page: number; // 0-based index within the chapter
  readonly updatedAt: number; // epoch ms; drives last-write-wins
}

export interface LibraryEntry {
  readonly mangaId: string;
  readonly addedAt: number; // epoch ms
}

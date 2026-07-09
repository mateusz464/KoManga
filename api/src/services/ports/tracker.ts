import { ApiError } from "../../http/errors.js";

export type TrackerStatus =
  | "reading"
  | "planning"
  | "completed"
  | "paused"
  | "dropped"
  | "rereading";

export interface TrackerToken {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly expiresAt?: Date;
  readonly refreshToken?: string;
}

export interface TrackerMediaCandidate {
  readonly mediaId: string;
  readonly title: string;
  readonly alternateTitles: readonly string[];
  readonly coverImageUrl?: string;
  readonly year?: number;
  readonly format?: string;
}

export interface TrackerListEntry {
  readonly progress: number;
  readonly status: TrackerStatus;
  readonly totalChapters?: number;
}

export interface TrackerViewer {
  readonly userId: string;
  readonly username: string;
}

export type TrackerErrorKind = "graphql" | "transport" | "token_exchange";

/**
 * Generic manga tracker port. Concrete adapters map provider-specific wire
 * shapes and enum names into these domain types before crossing this boundary.
 */
export interface Tracker {
  exchangeCode(code: string): Promise<TrackerToken>;
  getViewer?(accessToken: string): Promise<TrackerViewer>;
  searchMedia(title: string): Promise<TrackerMediaCandidate[]>;
  getListEntry(
    mediaId: string,
    accessToken?: string,
  ): Promise<TrackerListEntry | null>;
  saveProgress(
    mediaId: string,
    progress: number,
    status: TrackerStatus,
    accessToken?: string,
  ): Promise<TrackerListEntry>;
}

export class TrackerError extends ApiError {
  readonly kind: TrackerErrorKind;

  constructor(kind: TrackerErrorKind, cause?: unknown) {
    super("Tracker request failed", 502, "TRACKER_ERROR");
    this.kind = kind;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

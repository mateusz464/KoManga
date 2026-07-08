import {
  TrackerError,
  type TrackerListEntry,
  type TrackerMediaCandidate,
  type TrackerToken,
} from "../../../services/ports/tracker.js";
import { fromAniListStatus } from "./anilist-status.js";
import type { RawListEntry, RawMedia, RawToken } from "./anilist-wire-types.js";

export function mapToken(data: unknown): TrackerToken {
  const token = data as RawToken;
  if (
    typeof token.access_token !== "string" ||
    typeof token.token_type !== "string"
  ) {
    throw new TrackerError("token_exchange");
  }
  return {
    accessToken: token.access_token,
    tokenType: token.token_type,
    ...(typeof token.expires_in === "number"
      ? { expiresAt: new Date(Date.now() + token.expires_in * 1000) }
      : {}),
    ...(typeof token.refresh_token === "string"
      ? { refreshToken: token.refresh_token }
      : {}),
  };
}

export function mapMediaCandidate(media: RawMedia): TrackerMediaCandidate {
  const title = firstString(media.title?.romaji, media.title?.english) ?? "";
  return {
    mediaId: String(media.id),
    title,
    alternateTitles: [
      ...strings(media.title?.english, media.title?.native),
      ...arrayStrings(media.synonyms),
    ],
    ...(typeof media.coverImage?.large === "string"
      ? { coverImageUrl: media.coverImage.large }
      : {}),
  };
}

export function mapListEntry(entry: RawListEntry): TrackerListEntry {
  return {
    progress: typeof entry.progress === "number" ? entry.progress : 0,
    status: fromAniListStatus(entry.status),
  };
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}

function strings(...values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === "string");
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

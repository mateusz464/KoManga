import { AniListHttpTransport } from "./anilist-http-transport.js";
import { AniListTracker } from "./anilist-tracker.js";
import type { AniListTrackerOptions } from "./anilist-types.js";

export function createAniListTracker(
  options: AniListTrackerOptions,
): AniListTracker {
  return new AniListTracker(new AniListHttpTransport(), options);
}

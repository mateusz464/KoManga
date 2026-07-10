import {
  TrackerError,
  type TrackerStatus,
} from "../../../services/ports/tracker.js";

export function toAniListStatus(status: TrackerStatus): string {
  switch (status) {
    case "reading":
      return "CURRENT";
    case "planning":
      return "PLANNING";
    case "completed":
      return "COMPLETED";
    case "paused":
      return "PAUSED";
    case "dropped":
      return "DROPPED";
    case "rereading":
      return "REPEATING";
  }
}

export function fromAniListStatus(status: unknown): TrackerStatus {
  switch (status) {
    case "CURRENT":
      return "reading";
    case "PLANNING":
      return "planning";
    case "COMPLETED":
      return "completed";
    case "PAUSED":
      return "paused";
    case "DROPPED":
      return "dropped";
    case "REPEATING":
      return "rereading";
    default:
      throw new TrackerError("graphql");
  }
}

import { TrackerError } from "../../../services/ports/tracker.js";

export function toIntId(id: string): number {
  const parsed = Number(id);
  if (!Number.isInteger(parsed)) {
    throw new TrackerError("graphql");
  }
  return parsed;
}

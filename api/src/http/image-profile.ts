import { BadRequestError } from "./errors.js";
import type { ImageProfile } from "../services/ports/image-processor.js";

// Shared by the image-serving endpoints (page, cover): the profile is
// negotiated via the `profile` query param, defaulting to `raw`; only the
// `raw`/`eink` set is valid (RFC §6), anything else is rejected at the edge.
export function parseImageProfile(value: unknown): ImageProfile {
  if (value === undefined) {
    return "raw";
  }
  if (value === "raw" || value === "eink") {
    return value;
  }
  throw new BadRequestError(
    "Query parameter 'profile' must be 'raw' or 'eink'",
  );
}

import { BadRequestError } from "./errors.js";
import type { ImageProfile } from "../services/ports/image-processor.js";

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

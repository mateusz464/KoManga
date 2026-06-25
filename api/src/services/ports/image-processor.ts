// Port (interface) for page image processing (RFC §6, CLAUDE.md §6).
//
// Page serving is profile-negotiated, never e-ink-only:
//   - "raw"  : source bytes / lossless passthrough — for future full-colour
//              clients that process client-side.
//   - "eink" : greyscale, resized-to-fit the configured Kobo resolution,
//              contrast-tuned, encoded in the configured compact format.
//
// The transform parameters (target resolution + output format) are supplied to
// the concrete adapter at construction from config — never hardcoded — so the
// processor stays reusable by future server-side clients.

export type ImageProfile = "raw" | "eink";

/** An undecoded source image, e.g. the bytes returned by SuwayomiClient.fetchPage. */
export interface SourceImage {
  readonly bytes: Buffer;
  readonly contentType: string;
}

/** The result of processing — ready to serve to a client. */
export interface ProcessedImage {
  readonly bytes: Buffer;
  readonly contentType: string;
}

/**
 * The e-ink transform's tunable parameters. Concrete adapters receive these by
 * construction (DI) from {@link Config.image} — they are never read from the
 * environment inside the adapter.
 */
export interface EinkProfileOptions {
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly format: "png" | "jpeg" | "webp";
}

export interface ImageProcessor {
  /**
   * Process a source image under the requested profile. `raw` returns the
   * source unchanged (lossless passthrough); `eink` returns a greyscale image
   * fitted within the configured target dimensions in the configured format.
   */
  process(source: SourceImage, profile: ImageProfile): Promise<ProcessedImage>;
}

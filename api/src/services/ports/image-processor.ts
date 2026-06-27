// Page serving is profile-negotiated, never e-ink-only (RFC §6):
//   - "raw"  : lossless passthrough — for clients that process client-side.
//   - "eink" : greyscale, fitted to the Kobo resolution, contrast-tuned, compact.
export type ImageProfile = "raw" | "eink";

export interface SourceImage {
  readonly bytes: Buffer;
  readonly contentType: string;
}

export interface ProcessedImage {
  readonly bytes: Buffer;
  readonly contentType: string;
}

// Injected from Config.image so the eink transform is never hardcoded, keeping
// the processor reusable by future server-side clients (CLAUDE.md §6/§10).
export interface EinkProfileOptions {
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly format: "png" | "jpeg" | "webp";
}

export interface ImageProcessor {
  process(source: SourceImage, profile: ImageProfile): Promise<ProcessedImage>;
}

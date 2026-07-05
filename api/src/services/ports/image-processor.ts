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

export interface EinkProfileOptions {
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly format: "png" | "jpeg";
}

export interface ImageProcessor {
  process(source: SourceImage, profile: ImageProfile): Promise<ProcessedImage>;
}

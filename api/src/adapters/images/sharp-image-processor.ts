import sharp from "sharp";
import type {
  EinkProfileOptions,
  ImageProcessor,
  ImageProfile,
  ProcessedImage,
  SourceImage,
} from "../../services/ports/image-processor.js";

// `sharp` implementation of the ImageProcessor port (CLAUDE.md §6, §11).
//
// The eink transform's parameters (target resolution + output format) are
// injected at construction from `Config.image` — never hardcoded — so the
// processor stays reusable by future server-side clients (CLAUDE.md §6/§10).

const CONTENT_TYPES: Record<EinkProfileOptions["format"], string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export class SharpImageProcessor implements ImageProcessor {
  constructor(private readonly eink: EinkProfileOptions) {}

  async process(
    source: SourceImage,
    profile: ImageProfile,
  ): Promise<ProcessedImage> {
    // `raw` is a lossless passthrough — source bytes are served untouched for
    // future full-colour clients that process client-side (RFC §6).
    if (profile === "raw") {
      return source;
    }

    const { targetWidth, targetHeight, format } = this.eink;
    const bytes = await sharp(source.bytes)
      // Fit within the configured Kobo resolution, preserving aspect ratio and
      // never upscaling smaller pages.
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: "inside",
        withoutEnlargement: true,
      })
      .greyscale()
      // Contrast-tune for e-ink: stretch the tonal range to use full black/white.
      .normalise()
      .toFormat(format)
      .toBuffer();

    return { bytes, contentType: CONTENT_TYPES[format] };
  }
}

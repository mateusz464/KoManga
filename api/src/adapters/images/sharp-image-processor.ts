import type {
  EinkProfileOptions,
  ImageProcessor,
  ImageProfile,
  ProcessedImage,
  SourceImage,
} from "../../services/ports/image-processor.js";

// `sharp` implementation of the ImageProcessor port (CLAUDE.md §6, §11).
//
// STUB — API-403 ([TEST]) only pins the contract; the real transform is
// implemented in API-404. Until then `process()` throws so the paired tests
// fail red against the agreed contract.
export class SharpImageProcessor implements ImageProcessor {
  constructor(private readonly eink: EinkProfileOptions) {}

  process(_source: SourceImage, _profile: ImageProfile): Promise<ProcessedImage> {
    void this.eink;
    throw new Error("SharpImageProcessor.process is not implemented (API-404)");
  }
}

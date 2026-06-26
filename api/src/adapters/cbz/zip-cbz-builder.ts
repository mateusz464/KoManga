// Concrete CbzBuilder adapter: assembles processed pages into a CBZ (ZIP)
// archive (API-504). The real implementation lands in API-504; this stub
// throws so the API-503 contract tests execute and fail red.

import type {
  CbzBuilder,
  CbzPage,
} from "../../services/ports/cbz-builder.js";

export class ZipCbzBuilder implements CbzBuilder {
  build(_pages: readonly CbzPage[]): Promise<Buffer> {
    throw new Error("ZipCbzBuilder.build is not implemented yet (API-504)");
  }
}

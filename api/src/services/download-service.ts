import type { ImageProcessor, ImageProfile } from "./ports/image-processor.js";
import type { CbzBuilder } from "./ports/cbz-builder.js";
import type { DownloadStore } from "./ports/download-store.js";
import type {
  DownloadRecord,
  DownloadsRepository,
} from "./ports/downloads-repository.js";
import type { SuwayomiClient } from "./ports/suwayomi-client.js";
import { mapWithConcurrency } from "./map-with-concurrency.js";
import { NotFoundError } from "../http/errors.js";

// Turns a chapter into a persisted CBZ on the download volume (RFC §5.2), kept
// separate from the ephemeral session cache — downloads always serve from here.
export class DownloadService {
  constructor(
    private readonly suwayomi: SuwayomiClient,
    private readonly imageProcessor: ImageProcessor,
    private readonly cbzBuilder: CbzBuilder,
    private readonly store: DownloadStore,
    private readonly repository: DownloadsRepository,
    private readonly pageConcurrency: number,
  ) {}

  // Idempotent: an already-recorded chapter short-circuits — nothing refetched,
  // rebuilt or re-stored.
  async download(
    chapterId: string,
    mangaId: string,
    profile: ImageProfile,
  ): Promise<DownloadRecord> {
    const existing = this.repository.get(chapterId);
    if (existing !== undefined) {
      return existing;
    }

    // Resolve the chapter's page URLs once, then fetch + process pages with
    // bounded concurrency — same pipeline as the transient reader path, avoiding
    // both the per-page resolution N+1 and the serial sum-of-latencies build
    // (API-915/916).
    const pageUrls = await this.suwayomi.fetchPageUrls(chapterId);
    const pages = await mapWithConcurrency(
      pageUrls,
      this.pageConcurrency,
      async (url) => {
        const source = await this.suwayomi.fetchPageBytes(url);
        return this.imageProcessor.process(source, profile);
      },
    );

    const cbz = await this.cbzBuilder.build(pages);
    const cbzPath = await this.store.save(chapterId, cbz);

    const record: DownloadRecord = {
      chapterId,
      mangaId,
      cbzPath,
      status: "completed",
      createdAt: Date.now(),
    };
    this.repository.create(record);
    return record;
  }

  list(): DownloadRecord[] {
    return this.repository.list();
  }

  // Served from the persistent store, never the session cache (RFC §5.2).
  async getCbz(chapterId: string): Promise<Buffer> {
    const record = this.repository.get(chapterId);
    if (record === undefined) {
      throw new NotFoundError(`No download for chapter '${chapterId}'`);
    }
    const bytes = await this.store.read(chapterId);
    if (bytes === undefined) {
      throw new NotFoundError(`No stored CBZ for chapter '${chapterId}'`);
    }
    return bytes;
  }
}

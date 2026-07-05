import type { ImageProcessor, ImageProfile } from "./ports/image-processor.js";
import type { CbzBuilder, CbzPage } from "./ports/cbz-builder.js";
import type { DownloadStore } from "./ports/download-store.js";
import type {
  DownloadRecord,
  DownloadsRepository,
} from "./ports/downloads-repository.js";
import type { SuwayomiClient } from "./ports/suwayomi-client.js";
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

    // Resolve the chapter's page URLs once, then fetch + process each; re-running
    // resolution per page would issue an upstream page-resolution round-trip per
    // page (the same N+1 the transient reader path avoids).
    const pageUrls = await this.suwayomi.fetchPageUrls(chapterId);

    const pages: CbzPage[] = [];
    for (const url of pageUrls) {
      const source = await this.suwayomi.fetchPageBytes(url);
      pages.push(await this.imageProcessor.process(source, profile));
    }

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

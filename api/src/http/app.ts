import express from "express";
import type { SuwayomiClient } from "../services/ports/suwayomi-client.js";
import type { ImageProcessor } from "../services/ports/image-processor.js";
import type { SessionCache } from "../services/ports/session-cache.js";
import type { CbzBuilder } from "../services/ports/cbz-builder.js";
import type { DownloadStore } from "../services/ports/download-store.js";
import type { DownloadsRepository } from "../services/ports/downloads-repository.js";
import type { ReadingProgressRepository } from "../services/ports/reading-progress-repository.js";
import type { LibraryRepository } from "../services/ports/library-repository.js";
import { SourceService } from "../services/source-service.js";
import { SearchService } from "../services/search-service.js";
import { MangaService } from "../services/manga-service.js";
import { ChapterService } from "../services/chapter-service.js";
import { PageService } from "../services/page-service.js";
import { DownloadService } from "../services/download-service.js";
import { ProgressService } from "../services/progress-service.js";
import { LibraryService } from "../services/library-service.js";
import { sourcesRouter } from "../routes/sources.js";
import { searchRouter } from "../routes/search.js";
import { mangaRouter } from "../routes/manga.js";
import { chapterRouter } from "../routes/chapter.js";
import { pageRouter } from "../routes/page.js";
import { downloadsRouter } from "../routes/downloads.js";
import { progressRouter } from "../routes/progress.js";
import { libraryRouter } from "../routes/library.js";
import { errorHandler, notFoundHandler } from "./error-handler.js";
import { requireAuth } from "./auth.js";
import { rateLimit, type RateLimitOptions } from "./rate-limit.js";

// The optional deps gate which routers mount, so a test can pass just the ports
// an endpoint needs.
export interface AppDependencies {
  readonly suwayomi: SuwayomiClient;
  readonly authToken?: string;
  readonly rateLimit?: RateLimitOptions;
  readonly imageProcessor?: ImageProcessor;
  readonly sessionCache?: SessionCache;
  readonly prefetchWindow?: number;
  readonly cbzBuilder?: CbzBuilder;
  readonly downloadStore?: DownloadStore;
  readonly downloadsRepository?: DownloadsRepository;
  readonly readingProgressRepository?: ReadingProgressRepository;
  readonly libraryRepository?: LibraryRepository;
}

export function createApp(deps: AppDependencies): express.Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Rate limiting and auth mount before the feature routers so over-limit /
  // invalid-credential requests are rejected at the edge; /health stays public.
  if (deps.rateLimit) {
    app.use("/api", rateLimit(deps.rateLimit));
  }

  if (deps.authToken) {
    app.use("/api", requireAuth(deps.authToken));
  }

  app.use("/api", sourcesRouter(new SourceService(deps.suwayomi)));
  app.use("/api", searchRouter(new SearchService(deps.suwayomi)));
  app.use("/api", mangaRouter(new MangaService(deps.suwayomi)));
  app.use("/api", chapterRouter(new ChapterService(deps.suwayomi)));

  if (deps.imageProcessor && deps.sessionCache) {
    app.use(
      "/api",
      pageRouter(
        new PageService(
          deps.suwayomi,
          deps.imageProcessor,
          deps.sessionCache,
          deps.prefetchWindow,
        ),
      ),
    );
  }

  if (
    deps.imageProcessor &&
    deps.cbzBuilder &&
    deps.downloadStore &&
    deps.downloadsRepository
  ) {
    app.use(
      "/api",
      downloadsRouter(
        new DownloadService(
          deps.suwayomi,
          deps.imageProcessor,
          deps.cbzBuilder,
          deps.downloadStore,
          deps.downloadsRepository,
        ),
      ),
    );
  }

  if (deps.readingProgressRepository) {
    app.use(
      "/api",
      progressRouter(new ProgressService(deps.readingProgressRepository)),
    );
  }

  if (deps.libraryRepository) {
    app.use("/api", libraryRouter(new LibraryService(deps.libraryRepository)));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

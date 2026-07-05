import express from "express";
import type { SuwayomiClient } from "../services/ports/suwayomi-client.js";
import type { ImageProcessor } from "../services/ports/image-processor.js";
import type { SessionCache } from "../services/ports/session-cache.js";
import type { CbzBuilder } from "../services/ports/cbz-builder.js";
import type { DownloadStore } from "../services/ports/download-store.js";
import type { DownloadsRepository } from "../services/ports/downloads-repository.js";
import type { ReadingProgressRepository } from "../services/ports/reading-progress-repository.js";
import type { LibraryRepository } from "../services/ports/library-repository.js";
import type { Logger } from "../services/ports/logger.js";
import { SourceService } from "../services/source-service.js";
import { SearchService } from "../services/search-service.js";
import { MangaService } from "../services/manga-service.js";
import { ChapterService } from "../services/chapter-service.js";
import { PageService } from "../services/page-service.js";
import { CoverService } from "../services/cover-service.js";
import { DownloadService } from "../services/download-service.js";
import { ReaderService } from "../services/reader-service.js";
import { ProgressService } from "../services/progress-service.js";
import { LibraryService } from "../services/library-service.js";
import { sourcesRouter } from "../routes/sources.js";
import { searchRouter } from "../routes/search.js";
import { mangaRouter } from "../routes/manga.js";
import { chapterRouter } from "../routes/chapter.js";
import { pageRouter } from "../routes/page.js";
import { coverRouter } from "../routes/cover.js";
import { downloadsRouter } from "../routes/downloads.js";
import { readerRouter } from "../routes/reader.js";
import { progressRouter } from "../routes/progress.js";
import { libraryRouter } from "../routes/library.js";
import { createErrorHandler, notFoundHandler } from "./error-handler.js";
import { requireAuth } from "./auth.js";
import { rateLimit, type RateLimitOptions } from "./rate-limit.js";

// Null-object logger so endpoint tests can build an app without wiring logging.
const noop = (): void => undefined;
const NOOP_LOGGER: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

// The optional deps gate which routers mount, so a test can pass just the ports
// an endpoint needs.
export interface AppDependencies {
  readonly suwayomi: SuwayomiClient;
  readonly logger?: Logger;
  readonly requestLogger?: express.RequestHandler;
  readonly authToken?: string;
  readonly rateLimit?: RateLimitOptions;
  readonly imageProcessor?: ImageProcessor;
  readonly sessionCache?: SessionCache;
  readonly prefetchWindow?: number;
  readonly pageConcurrency?: number;
  readonly cbzBuilder?: CbzBuilder;
  readonly downloadStore?: DownloadStore;
  readonly downloadsRepository?: DownloadsRepository;
  readonly readingProgressRepository?: ReadingProgressRepository;
  readonly libraryRepository?: LibraryRepository;
  // When set, the API serves the built web client same-origin (KWC-202).
  readonly clientDir?: string;
}

// Mirrors config's CBZ_PAGE_CONCURRENCY default, for when a test omits the knob.
const DEFAULT_PAGE_CONCURRENCY = 6;

export function createApp(deps: AppDependencies): express.Express {
  const app = express();
  const pageConcurrency = deps.pageConcurrency ?? DEFAULT_PAGE_CONCURRENCY;

  // Before any routing, so even /health and rejected requests are logged.
  if (deps.requestLogger) {
    app.use(deps.requestLogger);
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Before the feature routers so over-limit / invalid-credential requests are
  // rejected at the edge; /health stays public.
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
    app.use(
      "/api",
      coverRouter(
        new CoverService(deps.suwayomi, deps.imageProcessor, deps.sessionCache),
      ),
    );
  }

  // Transient reader CBZ: mounted independently of the persistent download store
  // so reading a chapter doesn't record a download (RFC §5.2).
  if (deps.imageProcessor && deps.cbzBuilder && deps.sessionCache) {
    app.use(
      "/api",
      readerRouter(
        new ReaderService(
          deps.suwayomi,
          deps.imageProcessor,
          deps.cbzBuilder,
          deps.sessionCache,
          pageConcurrency,
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
          pageConcurrency,
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

  if (deps.libraryRepository && deps.readingProgressRepository) {
    app.use(
      "/api",
      libraryRouter(
        new LibraryService(
          deps.libraryRepository,
          deps.readingProgressRepository,
          deps.suwayomi,
        ),
      ),
    );
  }

  // After the /api routers so it can never shadow an API route; a non-file
  // request falls through to the JSON 404 below.
  if (deps.clientDir) {
    app.use(express.static(deps.clientDir));
  }

  app.use(notFoundHandler);
  app.use(createErrorHandler(deps.logger ?? NOOP_LOGGER));

  return app;
}

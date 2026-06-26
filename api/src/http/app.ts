import express from "express";
import type { SuwayomiClient } from "../services/ports/suwayomi-client.js";
import type { ImageProcessor } from "../services/ports/image-processor.js";
import type { SessionCache } from "../services/ports/session-cache.js";
import type { CbzBuilder } from "../services/ports/cbz-builder.js";
import type { DownloadStore } from "../services/ports/download-store.js";
import type { DownloadsRepository } from "../services/ports/downloads-repository.js";
import type { ReadingProgressRepository } from "../services/ports/reading-progress-repository.js";
import { SourceService } from "../services/source-service.js";
import { SearchService } from "../services/search-service.js";
import { MangaService } from "../services/manga-service.js";
import { ChapterService } from "../services/chapter-service.js";
import { PageService } from "../services/page-service.js";
import { DownloadService } from "../services/download-service.js";
import { sourcesRouter } from "../routes/sources.js";
import { searchRouter } from "../routes/search.js";
import { mangaRouter } from "../routes/manga.js";
import { chapterRouter } from "../routes/chapter.js";
import { pageRouter } from "../routes/page.js";
import { downloadsRouter } from "../routes/downloads.js";
import { errorHandler, notFoundHandler } from "./error-handler.js";

// Composition happens at the edge: concrete adapters are injected in and wired
// to services here, so the app never constructs its own external dependencies.
export interface AppDependencies {
  readonly suwayomi: SuwayomiClient;
  // Wired into the single-page endpoint (`GET /api/page/:id`) by API-408. Optional
  // here so endpoints that don't serve images keep their existing call sites.
  readonly imageProcessor?: ImageProcessor;
  readonly sessionCache?: SessionCache;
  // Background-prefetch window for the single-page endpoint (API-410). Configured
  // via Config.prefetch.window at the composition root; defaults to no prefetch.
  readonly prefetchWindow?: number;
  // Wired into the download endpoints (`POST /api/chapter/:id/download`,
  // `GET /api/downloads`, `GET /api/downloads/:chapterId`) by API-506. Optional
  // here so endpoints that don't deal with downloads keep their existing call
  // sites; the download router is only mounted when all three are present.
  readonly cbzBuilder?: CbzBuilder;
  readonly downloadStore?: DownloadStore;
  readonly downloadsRepository?: DownloadsRepository;
  // Wired into the reading-progress endpoints (`GET`/`PUT /api/progress/:mangaId`)
  // by API-602. Optional here so endpoints that don't deal with progress keep
  // their existing call sites; the progress router is only mounted when present.
  readonly readingProgressRepository?: ReadingProgressRepository;
}

export function createApp(deps: AppDependencies): express.Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api", sourcesRouter(new SourceService(deps.suwayomi)));
  app.use("/api", searchRouter(new SearchService(deps.suwayomi)));
  app.use("/api", mangaRouter(new MangaService(deps.suwayomi)));
  app.use("/api", chapterRouter(new ChapterService(deps.suwayomi)));

  // The single-page endpoint needs the image processor + session cache too, so
  // it is only mounted when both are wired in (the composition root always does;
  // metadata-only test call sites that pass just `suwayomi` skip it).
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

  // The download endpoints need the CBZ builder, the persistent store and the
  // downloads repository (in addition to the image processor already used for
  // page processing), so they are only mounted when all are wired in. The
  // composition root always does; metadata-only test call sites skip them.
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

  // 404 fallback for unmatched routes, then the centralised error handler.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

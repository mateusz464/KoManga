import { loadConfig } from "./config/index.js";
import { createSuwayomiClient } from "./adapters/suwayomi/client.js";
import { SharpImageProcessor } from "./adapters/images/sharp-image-processor.js";
import { InMemorySessionCache } from "./adapters/cache/in-memory-session-cache.js";
import { ZipCbzBuilder } from "./adapters/cbz/zip-cbz-builder.js";
import { FilesystemDownloadStore } from "./adapters/store/filesystem-download-store.js";
import { openDatabase } from "./adapters/db/database.js";
import { SqliteDownloadsRepository } from "./adapters/db/downloads-repository.js";
import { SqliteReadingProgressRepository } from "./adapters/db/reading-progress-repository.js";
import { SqliteLibraryRepository } from "./adapters/db/library-repository.js";
import { createApp } from "./http/app.js";

const config = loadConfig();

const suwayomi = createSuwayomiClient({
  baseUrl: config.suwayomi.url,
  authToken: config.auth.token,
});

const imageProcessor = new SharpImageProcessor({
  targetWidth: config.image.targetWidth,
  targetHeight: config.image.targetHeight,
  format: config.image.einkFormat,
});

const sessionCache = new InMemorySessionCache({
  maxBytes: config.cache.maxBytes,
  ttlMs: config.cache.ttlSeconds * 1000,
});

const db = openDatabase(config.paths.sqliteFile);
const cbzBuilder = new ZipCbzBuilder();
const downloadStore = new FilesystemDownloadStore(config.paths.cbzStore);
const downloadsRepository = new SqliteDownloadsRepository(db);
const readingProgressRepository = new SqliteReadingProgressRepository(db);
const libraryRepository = new SqliteLibraryRepository(db);

const app = createApp({
  suwayomi,
  authToken: config.auth.token,
  rateLimit: {
    limit: config.rateLimit.limit,
    windowMs: config.rateLimit.windowMs,
  },
  imageProcessor,
  sessionCache,
  prefetchWindow: config.prefetch.window,
  cbzBuilder,
  downloadStore,
  downloadsRepository,
  readingProgressRepository,
  libraryRepository,
});

app.listen(config.port, () => {
  console.log(`KoManga API listening on port ${config.port}`);
});

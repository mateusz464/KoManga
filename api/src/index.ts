import { loadConfig } from "./config/index.js";
import { createSuwayomiClient } from "./adapters/suwayomi/client.js";
import { SharpImageProcessor } from "./adapters/images/sharp-image-processor.js";
import { InMemorySessionCache } from "./adapters/cache/in-memory-session-cache.js";
import { ZipCbzBuilder } from "./adapters/cbz/zip-cbz-builder.js";
import { FilesystemDownloadStore } from "./adapters/store/filesystem-download-store.js";
import { openDatabase } from "./adapters/db/database.js";
import { SqliteDownloadsRepository } from "./adapters/db/downloads-repository.js";
import { createApp } from "./http/app.js";

// Composition root: load config, construct concrete adapters, inject them.
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

// Persistent download path: CBZs built here, stored on their own volume
// (config.paths.cbzStore), recorded in our SQLite — kept separate from the
// ephemeral session cache (RFC §5.2/§7).
const db = openDatabase(config.paths.sqliteFile);
const cbzBuilder = new ZipCbzBuilder();
const downloadStore = new FilesystemDownloadStore(config.paths.cbzStore);
const downloadsRepository = new SqliteDownloadsRepository(db);

const app = createApp({
  suwayomi,
  imageProcessor,
  sessionCache,
  prefetchWindow: config.prefetch.window,
  cbzBuilder,
  downloadStore,
  downloadsRepository,
});

app.listen(config.port, () => {
  console.log(`KoManga API listening on port ${config.port}`);
});

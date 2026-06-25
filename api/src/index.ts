import { loadConfig } from "./config/index.js";
import { createSuwayomiClient } from "./adapters/suwayomi/client.js";
import { SharpImageProcessor } from "./adapters/images/sharp-image-processor.js";
import { InMemorySessionCache } from "./adapters/cache/in-memory-session-cache.js";
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

const app = createApp({
  suwayomi,
  imageProcessor,
  sessionCache,
  prefetchWindow: config.prefetch.window,
});

app.listen(config.port, () => {
  console.log(`KoManga API listening on port ${config.port}`);
});

import { loadConfig } from "./config/index.js";
import { createSuwayomiClient } from "./adapters/suwayomi/client.js";
import { createApp } from "./http/app.js";

// Composition root: load config, construct concrete adapters, inject them.
const config = loadConfig();

const suwayomi = createSuwayomiClient({
  baseUrl: config.suwayomi.url,
  authToken: config.auth.token,
});

const app = createApp({ suwayomi });

app.listen(config.port, () => {
  console.log(`KoManga API listening on port ${config.port}`);
});

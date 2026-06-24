import { loadConfig } from "./config/index.js";
import { createApp } from "./http/app.js";

// Load config before binding the port so misconfiguration fails fast.
const config = loadConfig();
const app = createApp();

app.listen(config.port, () => {
  console.log(`KoManga API listening on port ${config.port}`);
});

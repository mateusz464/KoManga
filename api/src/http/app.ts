import express from "express";
import type { SuwayomiClient } from "../services/ports/suwayomi-client.js";
import { SourceService } from "../services/source-service.js";
import { sourcesRouter } from "../routes/sources.js";
import { errorHandler, notFoundHandler } from "./error-handler.js";

// Composition happens at the edge: concrete adapters are injected in and wired
// to services here, so the app never constructs its own external dependencies.
export interface AppDependencies {
  readonly suwayomi: SuwayomiClient;
}

export function createApp(deps: AppDependencies): express.Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api", sourcesRouter(new SourceService(deps.suwayomi)));

  // 404 fallback for unmatched routes, then the centralised error handler.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

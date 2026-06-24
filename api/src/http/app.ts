import express from "express";
import { errorHandler, notFoundHandler } from "./error-handler.js";

export function createApp(): express.Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // 404 fallback for unmatched routes, then the centralised error handler.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

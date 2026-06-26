import { Router } from "express";
import type { SourceService } from "../services/source-service.js";

export function sourcesRouter(service: SourceService): Router {
  const router = Router();

  router.get("/sources", async (_req, res) => {
    const sources = await service.listSources();
    res.json({ data: sources });
  });

  return router;
}

import { Router } from "express";
import type { SourceService } from "../services/source-service.js";

// HTTP edge for source browsing: delegates to the service and wraps the result
// in the standard success envelope. No business logic here (CLAUDE.md §3).
export function sourcesRouter(service: SourceService): Router {
  const router = Router();

  router.get("/sources", async (_req, res) => {
    const sources = await service.listSources();
    res.json({ data: sources });
  });

  return router;
}

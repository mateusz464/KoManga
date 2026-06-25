import { Router } from "express";
import type { MangaService } from "../services/manga-service.js";

// HTTP edge for the manga detail view: delegates to the service and wraps the
// result in the standard success envelope. No business logic here (CLAUDE.md §3).
export function mangaRouter(service: MangaService): Router {
  const router = Router();

  router.get("/manga/:id", async (req, res) => {
    const view = await service.getManga(req.params.id);
    res.json({ data: view });
  });

  return router;
}

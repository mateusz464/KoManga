import { Router } from "express";
import type { ChapterService } from "../services/chapter-service.js";

// HTTP edge for the chapter page list: delegates to the service and wraps the
// result in the standard success envelope. No business logic here (CLAUDE.md §3).
export function chapterRouter(service: ChapterService): Router {
  const router = Router();

  router.get("/chapter/:id/pages", async (req, res) => {
    const pages = await service.getPages(req.params.id);
    res.json({ data: pages });
  });

  return router;
}

import { Router } from "express";
import type { ChapterService } from "../services/chapter-service.js";

export function chapterRouter(service: ChapterService): Router {
  const router = Router();

  router.get("/chapter/:id/pages", async (req, res) => {
    const pages = await service.getPages(req.params.id);
    res.json({ data: pages });
  });

  return router;
}

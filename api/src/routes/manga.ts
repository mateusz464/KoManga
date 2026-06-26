import { Router } from "express";
import type { MangaService } from "../services/manga-service.js";

export function mangaRouter(service: MangaService): Router {
  const router = Router();

  router.get("/manga/:id", async (req, res) => {
    const view = await service.getManga(req.params.id);
    res.json({ data: view });
  });

  return router;
}

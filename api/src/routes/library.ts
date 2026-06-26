import { Router, json } from "express";
import { BadRequestError } from "../http/errors.js";
import type { LibraryService } from "../services/library-service.js";

export function libraryRouter(service: LibraryService): Router {
  const router = Router();

  router.get("/library", (_req, res) => {
    res.json({ data: service.list() });
  });

  router.put("/library/:mangaId", json(), (req, res) => {
    const body = req.body as Record<string, unknown>;

    const addedAt = body.addedAt;
    if (typeof addedAt !== "number" || !Number.isFinite(addedAt)) {
      throw new BadRequestError("Body field 'addedAt' must be a number");
    }

    // Device-agnostic: build from our fields only, so any deviceId is dropped.
    const entry = service.follow({ mangaId: req.params.mangaId, addedAt });
    res.json({ data: entry });
  });

  router.delete("/library/:mangaId", (req, res) => {
    service.unfollow(req.params.mangaId);
    res.json({ data: { mangaId: req.params.mangaId } });
  });

  return router;
}

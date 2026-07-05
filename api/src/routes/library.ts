import { Router, json } from "express";
import { BadRequestError } from "../http/errors.js";
import type { LibraryService } from "../services/library-service.js";
import type { LibraryEntry } from "../services/ports/library-repository.js";

export function libraryRouter(service: LibraryService): Router {
  const router = Router();

  router.get("/library", async (_req, res) => {
    res.json({ data: await service.list() });
  });

  router.put("/library/:mangaId", json(), (req, res) => {
    const body = req.body as Record<string, unknown>;

    const addedAt = body.addedAt;
    if (typeof addedAt !== "number" || !Number.isFinite(addedAt)) {
      throw new BadRequestError("Body field 'addedAt' must be a number");
    }

    // Device-agnostic: build from our fields only, so any deviceId is dropped.
    // Capture the display title at follow time (API-908) when the client sends
    // one; it is optional, so a title-less follow still succeeds.
    const title = body.title;
    const entry: LibraryEntry =
      typeof title === "string"
        ? { mangaId: req.params.mangaId, addedAt, title }
        : { mangaId: req.params.mangaId, addedAt };
    res.json({ data: service.follow(entry) });
  });

  router.delete("/library/:mangaId", (req, res) => {
    service.unfollow(req.params.mangaId);
    res.json({ data: { mangaId: req.params.mangaId } });
  });

  return router;
}

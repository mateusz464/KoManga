import { Router, json } from "express";
import { BadRequestError } from "../http/errors.js";
import type { ProgressService } from "../services/progress-service.js";

export function progressRouter(service: ProgressService): Router {
  const router = Router();

  router.put("/progress/:mangaId", json(), (req, res) => {
    const body = req.body as Record<string, unknown>;

    const chapterId = body.chapterId;
    if (typeof chapterId !== "string" || chapterId.trim() === "") {
      throw new BadRequestError("Body field 'chapterId' is required");
    }
    const page = body.page;
    if (typeof page !== "number" || !Number.isFinite(page)) {
      throw new BadRequestError("Body field 'page' must be a number");
    }
    const updatedAt = body.updatedAt;
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) {
      throw new BadRequestError("Body field 'updatedAt' must be a number");
    }

    // Device-agnostic: build from our fields only, so any deviceId is dropped.
    const stored = service.save({
      mangaId: req.params.mangaId,
      chapterId,
      page,
      updatedAt,
    });
    res.json({ data: stored });
  });

  router.get("/progress/:mangaId", (req, res) => {
    res.json({ data: service.get(req.params.mangaId) });
  });

  return router;
}

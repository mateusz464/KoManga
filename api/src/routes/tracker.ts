import { Router, json } from "express";
import { BadRequestError } from "../http/errors.js";
import type { TrackingService } from "../services/tracking-service.js";

export function trackerRouter(service: TrackingService): Router {
  const router = Router();

  router.get("/tracker/manga/:mangaId/candidates", async (req, res) => {
    res.json({ data: await service.candidates(req.params.mangaId) });
  });

  router.put("/tracker/manga/:mangaId/match", json(), (req, res) => {
    const body = req.body as Record<string, unknown>;
    const mediaId = body.mediaId;
    if (typeof mediaId !== "string") {
      throw new BadRequestError("Body field 'mediaId' must be a string");
    }

    res.json({ data: service.setMatch(req.params.mangaId, mediaId) });
  });

  router.delete("/tracker/manga/:mangaId/match", (req, res) => {
    res.json({ data: service.clearMatch(req.params.mangaId) });
  });

  router.post("/tracker/manga/:mangaId/do-not-track", (_req, res) => {
    res.json({ data: service.setDoNotTrack(_req.params.mangaId) });
  });

  router.get("/tracker/manga/:mangaId/status", (req, res) => {
    res.json({ data: service.status(req.params.mangaId) });
  });

  router.post("/tracker/complete", json(), (req, res) => {
    const body = req.body as Record<string, unknown>;
    const chapterId = body.chapterId;
    if (typeof chapterId !== "string" || chapterId.trim() === "") {
      throw new BadRequestError(
        "Body field 'chapterId' must be a non-empty string",
      );
    }

    void service.completeChapter(chapterId);
    res.status(202).json({ data: { status: "accepted" } });
  });

  return router;
}

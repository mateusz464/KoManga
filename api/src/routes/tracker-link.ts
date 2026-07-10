import { Router } from "express";
import { BadRequestError } from "../http/errors.js";
import type { TrackerLinkService } from "../services/tracker-link-service.js";

function requireQueryString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestError(`${name} is required`);
  }
  return value;
}

export function publicTrackerLinkRouter(service: TrackerLinkService): Router {
  const router = Router();

  router.get("/tracker/anilist/callback", async (req, res) => {
    const code = requireQueryString(req.query.code, "code");
    const state = requireQueryString(req.query.state, "state");
    const result = await service.complete(code, state);
    res.json({ data: result });
  });

  return router;
}

export function protectedTrackerLinkRouter(
  service: TrackerLinkService,
): Router {
  const router = Router();

  router.post("/tracker/anilist/link", (_req, res) => {
    res.json({ data: service.createSession() });
  });

  router.get("/tracker/anilist/link/:sessionId/status", (req, res) => {
    res.json({ data: { status: service.getStatus(req.params.sessionId) } });
  });

  router.get("/tracker/anilist/link/:sessionId/qr.png", async (req, res) => {
    const png = await service.renderQrPng(req.params.sessionId);
    res.type("png").send(png);
  });

  return router;
}

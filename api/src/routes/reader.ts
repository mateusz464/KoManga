import { Router } from "express";
import { parseImageProfile } from "../http/image-profile.js";
import type { ReaderService } from "../services/reader-service.js";

export function readerRouter(service: ReaderService): Router {
  const router = Router();

  // Transient read path: build + serve the chapter's CBZ (profile-negotiated,
  // eink for the Kobo) from the ephemeral session cache. Never persists a
  // download — POST /chapter/:id/download is the explicit, listed path.
  router.get("/chapter/:id/cbz", async (req, res) => {
    const profile = parseImageProfile(req.query.profile);
    const cbz = await service.readCbz(req.params.id, profile);
    res.type(cbz.contentType).send(cbz.bytes);
  });

  return router;
}

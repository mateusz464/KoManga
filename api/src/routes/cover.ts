import { Router } from "express";
import { parseImageProfile } from "../http/image-profile.js";
import type { CoverService } from "../services/cover-service.js";

export function coverRouter(service: CoverService): Router {
  const router = Router();

  router.get("/manga/:id/cover", async (req, res) => {
    const profile = parseImageProfile(req.query.profile);
    const cover = await service.getCover(req.params.id, profile);
    res.type(cover.contentType).send(cover.bytes);
  });

  return router;
}

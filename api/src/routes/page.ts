import { Router } from "express";
import { parseImageProfile } from "../http/image-profile.js";
import type { PageService } from "../services/page-service.js";

export function pageRouter(service: PageService): Router {
  const router = Router();

  router.get("/page/:id", async (req, res) => {
    const profile = parseImageProfile(req.query.profile);
    const page = await service.getPage(req.params.id, profile);
    res.type(page.contentType).send(page.bytes);
  });

  return router;
}

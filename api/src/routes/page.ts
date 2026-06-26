import { Router } from "express";
import { BadRequestError } from "../http/errors.js";
import type { PageService } from "../services/page-service.js";
import type { ImageProfile } from "../services/ports/image-processor.js";

// HTTP edge for single-page serving: negotiates the image profile and streams
// the processed bytes with their content-type. No business logic here
// (CLAUDE.md §3) — the fetch → process → cache flow lives in the service. Unlike
// the metadata endpoints, the response body is the image itself, not an envelope.
export function pageRouter(service: PageService): Router {
  const router = Router();

  router.get("/page/:id", async (req, res) => {
    const profile = parseProfile(req.query.profile);
    const page = await service.getPage(req.params.id, profile);
    res.type(page.contentType).send(page.bytes);
  });

  return router;
}

// `profile` defaults to `raw`; only `raw`/`eink` are supported (RFC §6). Anything
// else is rejected at the edge with a 400 before any port is touched.
function parseProfile(value: unknown): ImageProfile {
  if (value === undefined) {
    return "raw";
  }
  if (value === "raw" || value === "eink") {
    return value;
  }
  throw new BadRequestError(
    "Query parameter 'profile' must be 'raw' or 'eink'",
  );
}

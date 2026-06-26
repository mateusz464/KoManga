import { Router } from "express";
import { BadRequestError } from "../http/errors.js";
import type { DownloadService } from "../services/download-service.js";
import type { ImageProfile } from "../services/ports/image-processor.js";

const CBZ_CONTENT_TYPE = "application/vnd.comicbook+zip";

// HTTP edge for the download endpoints (RFC §5.2). Validates input and shapes
// responses; the build → store → record flow lives in the service (CLAUDE.md §3).
//   POST /api/chapter/:id/download — build + persist + record a chapter download.
//   GET  /api/downloads            — list download records.
//   GET  /api/downloads/:chapterId — serve a stored CBZ from the persistent store.
export function downloadsRouter(service: DownloadService): Router {
  const router = Router();

  router.post("/chapter/:id/download", async (req, res) => {
    // The client is browsing the manga when it triggers the download, so it
    // supplies the chapter's mangaId; the SuwayomiClient port has no
    // chapter→manga lookup. Validate at the edge before touching any port.
    const mangaId = req.query.mangaId;
    if (typeof mangaId !== "string" || mangaId.trim() === "") {
      throw new BadRequestError("Query parameter 'mangaId' is required");
    }
    const profile = parseProfile(req.query.profile);

    const record = await service.download(req.params.id, mangaId, profile);
    res.json({ data: record });
  });

  router.get("/downloads", (_req, res) => {
    res.json({ data: service.list() });
  });

  router.get("/downloads/:chapterId", async (req, res) => {
    const cbz = await service.getCbz(req.params.chapterId);
    res.type(CBZ_CONTENT_TYPE).send(cbz);
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

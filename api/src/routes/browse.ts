import { Router } from "express";
import { BadRequestError } from "../http/errors.js";
import type { BrowseService } from "../services/browse-service.js";
import type { BrowseParams } from "../services/ports/suwayomi-client.js";

export function browseRouter(service: BrowseService): Router {
  const router = Router();

  router.get("/browse", async (req, res) => {
    const sourceId = firstParam(req.query.source);
    const mode = firstParam(req.query.mode);
    if (!sourceId) {
      throw new BadRequestError("Query parameter 'source' is required");
    }
    if (mode !== "popular" && mode !== "latest") {
      throw new BadRequestError(
        "Query parameter 'mode' must be 'popular' or 'latest'",
      );
    }
    const params: BrowseParams = { sourceId, mode };
    const page = parsePage(firstParam(req.query.page));
    const result = await service.browse(
      page === undefined ? params : { ...params, page },
    );
    res.json({ data: result });
  });

  router.get("/source/:id/filters", async (req, res) => {
    const genres = await service.listSourceGenres(req.params.id);
    res.json({ data: genres });
  });

  return router;
}

function firstParam(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parsePage(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const page = Number(value);
  return Number.isFinite(page) ? page : undefined;
}

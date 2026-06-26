import { Router } from "express";
import { BadRequestError } from "../http/errors.js";
import type { SearchService } from "../services/search-service.js";
import type { SearchParams } from "../services/ports/suwayomi-client.js";

export function searchRouter(service: SearchService): Router {
  const router = Router();

  router.get("/search", async (req, res) => {
    const query = firstParam(req.query.q);
    const sourceId = firstParam(req.query.source);

    if (!query) {
      throw new BadRequestError("Query parameter 'q' is required");
    }
    if (!sourceId) {
      throw new BadRequestError("Query parameter 'source' is required");
    }

    const params: SearchParams = { sourceId, query };
    const page = parsePage(firstParam(req.query.page));

    const result = await service.search(
      page === undefined ? params : { ...params, page },
    );
    res.json({ data: result });
  });

  return router;
}

// Express query values may be arrays/objects; accept only a non-empty scalar.
function firstParam(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parsePage(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const page = Number(value);
  return Number.isFinite(page) ? page : undefined;
}

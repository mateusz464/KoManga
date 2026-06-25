import { Router } from "express";
import { BadRequestError } from "../http/errors.js";
import type { SearchService } from "../services/search-service.js";
import type { SearchParams } from "../services/ports/suwayomi-client.js";

// HTTP edge for source search: validates the query string, maps it to the
// service's SearchParams, and wraps the result in the standard success envelope.
// No business logic here (CLAUDE.md §3); validation/coercion stays at the edge.
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

// Express query values can be string | string[] | ParsedQs; we only accept a
// single non-empty scalar string and ignore anything else.
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

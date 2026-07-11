import { Router } from "express";
import { BadRequestError } from "../http/errors.js";
import type { SearchService } from "../services/search-service.js";
import type { SearchParams } from "../services/ports/suwayomi-client.js";

export function searchRouter(service: SearchService): Router {
  const router = Router();

  router.get("/search", async (req, res) => {
    const query = firstParam(req.query.q);
    const sourceId = firstParam(req.query.source);
    const genres = params(req.query.genre);

    if (!query && genres.length === 0) {
      throw new BadRequestError("Query parameter 'q' is required");
    }
    if (!sourceId) {
      throw new BadRequestError("Query parameter 'source' is required");
    }

    const searchParams: SearchParams = {
      sourceId,
      query: query ?? "",
      ...(genres.length > 0 ? { genres } : {}),
    };
    const page = parsePage(firstParam(req.query.page));

    const result = await service.search(
      page === undefined ? searchParams : { ...searchParams, page },
    );
    res.json({ data: result });
  });

  return router;
}

function params(value: unknown): string[] {
  if (typeof value === "string" && value.length > 0) return [value];
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];
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

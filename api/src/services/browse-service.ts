import { BadRequestError } from "../http/errors.js";
import type {
  BrowseParams,
  GenreOption,
  SearchResult,
  SuwayomiClient,
} from "./ports/suwayomi-client.js";

export class BrowseService {
  constructor(private readonly suwayomi: SuwayomiClient) {}

  async browse(params: BrowseParams): Promise<SearchResult> {
    if (params.mode === "latest") {
      const source = (await this.suwayomi.listSources()).find(
        ({ id }) => id === params.sourceId,
      );
      if (source && !source.supportsLatest) {
        throw new BadRequestError(
          "Latest listings are not supported by this source",
        );
      }
    }
    if (!this.suwayomi.browse) {
      throw new Error("Suwayomi client does not support source browsing");
    }
    return this.suwayomi.browse(params);
  }

  listSourceGenres(sourceId: string): Promise<GenreOption[]> {
    if (!this.suwayomi.listSourceGenres) {
      throw new Error("Suwayomi client does not support source filters");
    }
    return this.suwayomi.listSourceGenres(sourceId);
  }
}

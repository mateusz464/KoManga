import type {
  SearchParams,
  SearchResult,
  SuwayomiClient,
} from "./ports/suwayomi-client.js";

// Business logic for source search. Knows nothing about Express; it depends on
// the SuwayomiClient port and is constructed with a concrete adapter at startup.
export class SearchService {
  constructor(private readonly suwayomi: SuwayomiClient) {}

  search(params: SearchParams): Promise<SearchResult> {
    return this.suwayomi.search(params);
  }
}

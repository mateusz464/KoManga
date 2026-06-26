import type {
  SearchParams,
  SearchResult,
  SuwayomiClient,
} from "./ports/suwayomi-client.js";

export class SearchService {
  constructor(private readonly suwayomi: SuwayomiClient) {}

  search(params: SearchParams): Promise<SearchResult> {
    return this.suwayomi.search(params);
  }
}

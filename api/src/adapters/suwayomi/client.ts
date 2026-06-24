// Red-phase stub for the Suwayomi GraphQL client (API-201). It satisfies the
// SuwayomiClient port's shape so the contract tests compile and run, but every
// method rejects — the real graphql-request mapping is implemented in API-202,
// which is what turns the API-201 tests green.

import type {
  Chapter,
  MangaDetails,
  PageRef,
  RawPage,
  SearchParams,
  SearchResult,
  Source,
  SuwayomiClient,
} from "../../services/ports/suwayomi-client.js";
import type { GraphQLTransport } from "./transport.js";

const NOT_IMPLEMENTED =
  "SuwayomiGraphQLClient is not implemented yet — see API-202";

export class SuwayomiGraphQLClient implements SuwayomiClient {
  constructor(private readonly transport: GraphQLTransport) {}

  listSources(): Promise<Source[]> {
    return this.notImplemented();
  }

  search(_params: SearchParams): Promise<SearchResult> {
    return this.notImplemented();
  }

  getMangaDetails(_mangaId: string): Promise<MangaDetails> {
    return this.notImplemented();
  }

  listChapters(_mangaId: string): Promise<Chapter[]> {
    return this.notImplemented();
  }

  fetchPage(_ref: PageRef): Promise<RawPage> {
    return this.notImplemented();
  }

  private notImplemented<T>(): Promise<T> {
    // Reference the transport so the wiring is exercised; the real queries land
    // in API-202.
    void this.transport;
    return Promise.reject(new Error(NOT_IMPLEMENTED));
  }
}

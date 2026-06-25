import type {
  Source,
  SuwayomiClient,
} from "./ports/suwayomi-client.js";

// Business logic for source browsing. Knows nothing about Express; it depends on
// the SuwayomiClient port and is constructed with a concrete adapter at startup.
export class SourceService {
  constructor(private readonly suwayomi: SuwayomiClient) {}

  listSources(): Promise<Source[]> {
    return this.suwayomi.listSources();
  }
}

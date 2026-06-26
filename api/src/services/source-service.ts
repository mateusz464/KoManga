import type { Source, SuwayomiClient } from "./ports/suwayomi-client.js";

export class SourceService {
  constructor(private readonly suwayomi: SuwayomiClient) {}

  listSources(): Promise<Source[]> {
    return this.suwayomi.listSources();
  }
}

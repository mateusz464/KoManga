import type { SuwayomiClient } from "../../src/services/ports/suwayomi-client.js";

// A SuwayomiClient whose every method throws — for tests that exercise routes
// (health, 404) which must never touch the upstream port. Tests that do drive a
// source call build their own controllable stub.
export function stubSuwayomi(): SuwayomiClient {
  const unexpected = async (): Promise<never> => {
    throw new Error("unexpected Suwayomi call");
  };
  return {
    listSources: unexpected,
    search: unexpected,
    getMangaDetails: unexpected,
    listChapters: unexpected,
    getChapterPageCount: unexpected,
    fetchPage: unexpected,
  };
}

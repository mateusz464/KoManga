// One CBZ file per chapter on the persistent download volume — kept separate
// from the session cache and never auto-pruned by it (RFC §5.2/§7).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DownloadStore } from "../../services/ports/download-store.js";

export class FilesystemDownloadStore implements DownloadStore {
  constructor(private readonly baseDir: string) {}

  async save(chapterId: string, cbz: Buffer): Promise<string> {
    const path = this.pathFor(chapterId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, cbz);
    return path;
  }

  async read(chapterId: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.pathFor(chapterId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw err;
    }
  }

  private pathFor(chapterId: string): string {
    return join(this.baseDir, `${chapterId}.cbz`);
  }
}

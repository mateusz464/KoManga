// Filesystem implementation of the DownloadStore port (RFC §5.2/§7).
//
// CBZs the user explicitly chose to keep are written under a base directory
// mounted on its own Docker volume (CLAUDE.md §7), one file per chapter. This
// store is physically separate from the ephemeral session cache and is never
// auto-pruned by cache logic. The base directory is supplied by construction
// (DI from Config.paths.cbzStore at the composition root).

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
    // Chapter ids are numeric (from Suwayomi), so a flat "<id>.cbz" name is safe.
    return join(this.baseDir, `${chapterId}.cbz`);
  }
}

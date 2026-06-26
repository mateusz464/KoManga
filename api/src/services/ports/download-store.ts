// Port (interface) for the persistent CBZ download store (RFC §5.2/§7,
// CLAUDE.md §7).
//
// CBZs the user explicitly chose to keep live on their own Docker volume, kept
// physically and conceptually separate from the ephemeral session cache — they
// are NEVER auto-pruned by session-cache logic, and a downloaded chapter is
// always served from here, never from the session cache (RFC §5.2 step 4).
//
// This port hides the volume behind an interface so the download service depends
// on the capability, not the filesystem, and can be mocked in upstream tests
// (API-505). The concrete adapter (filesystem on the mounted volume) lands with
// the download endpoints in API-506.

export interface DownloadStore {
  /**
   * Persist a chapter's CBZ archive to the store and return the path it was
   * written to. That path is recorded as `cbzPath` on the download record so the
   * archive can later be located and served from disk.
   */
  save(chapterId: string, cbz: Buffer): Promise<string>;

  /**
   * Read back a stored CBZ for serving. Resolves `undefined` when no archive is
   * stored for the chapter. Served chapters always come from here, surviving
   * session-cache pruning (RFC §5.2).
   */
  read(chapterId: string): Promise<Buffer | undefined>;
}

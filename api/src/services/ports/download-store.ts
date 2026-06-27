// The persistent CBZ store on its own Docker volume (RFC §5.2/§7): separate from
// the session cache and never auto-pruned by it; downloads always serve from here.
export interface DownloadStore {
  // Persists a chapter's CBZ and returns its path (recorded as cbzPath).
  save(chapterId: string, cbz: Buffer): Promise<string>;
  read(chapterId: string): Promise<Buffer | undefined>;
}

// The persistent CBZ store: separate from the session cache and never
// auto-pruned by it (RFC §5.2/§7).
export interface DownloadStore {
  // Returns the stored path, recorded as a DownloadRecord's cbzPath.
  save(chapterId: string, cbz: Buffer): Promise<string>;
  read(chapterId: string): Promise<Buffer | undefined>;
}

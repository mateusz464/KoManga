// Assembles processed pages into a CBZ (a ZIP of page images). Pure: returns the
// archive bytes; storing them is the download service's concern (API-505/506).

/**
 * One already-processed page, in chapter order. Bytes are stored verbatim (no
 * re-encode — pages are already processed); `contentType` only picks the entry's
 * file extension. {@link ProcessedImage} satisfies this shape.
 */
export interface CbzPage {
  readonly bytes: Buffer;
  readonly contentType: string;
}

export interface CbzBuilder {
  /**
   * Assemble `pages` into a CBZ (ZIP) archive and return its bytes. Entry
   * filenames are zero-padded so their lexicographic order — the order a
   * standard reader displays them in — matches the order of `pages`.
   */
  build(pages: readonly CbzPage[]): Promise<Buffer>;
}

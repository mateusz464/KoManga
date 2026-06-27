// Assembles processed pages into a CBZ (a ZIP of page images). Pure: returns the
// archive bytes; storing them is the download service's concern (API-505/506).

export interface CbzPage {
  // Bytes are archived verbatim (pages are already processed); contentType only
  // picks the entry's file extension. ProcessedImage satisfies this shape.
  readonly bytes: Buffer;
  readonly contentType: string;
}

export interface CbzBuilder {
  // Pages are archived in array order; entry filenames are zero-padded so a
  // reader's lexicographic display order matches it.
  build(pages: readonly CbzPage[]): Promise<Buffer>;
}

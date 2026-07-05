export interface CbzPage {
  readonly bytes: Buffer;
  // Only picks the archive entry's file extension; the bytes are stored verbatim.
  readonly contentType: string;
}

export interface CbzBuilder {
  // Pages are archived in array order; entry filenames are zero-padded so a
  // reader's lexicographic display order matches it.
  build(pages: readonly CbzPage[]): Promise<Buffer>;
}

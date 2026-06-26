// Port (interface) for assembling processed pages into a CBZ archive
// (RFC §5, CLAUDE.md §3). A CBZ is simply a ZIP whose entries are page images,
// shown by a reader in lexicographic filename order — so the builder is
// responsible for naming entries such that that order matches chapter order.
//
// The builder is pure: it returns the archive bytes and knows nothing about
// where they are stored. Persisting the CBZ to the download volume and
// recording it in SQLite is the download service's concern (API-505/506),
// kept deliberately separate from the ephemeral session cache (RFC §7).
//
// Services depend on this interface, never a concrete adapter, so it can be
// mocked in upstream tests (API-505) and the archive library swapped without
// changing callers.

/**
 * One already-processed page to include in the archive, in chapter order. The
 * bytes are stored verbatim (the builder must not re-encode — pages have
 * already been through the {@link ImageProcessor}); `contentType` only selects
 * the entry's file extension. {@link ProcessedImage} satisfies this shape.
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

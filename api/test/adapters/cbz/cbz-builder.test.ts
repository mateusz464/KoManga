import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { ZipCbzBuilder } from "../../../src/adapters/cbz/zip-cbz-builder.js";
import type {
  CbzBuilder,
  CbzPage,
} from "../../../src/services/ports/cbz-builder.js";

// Contract test for the CbzBuilder port (API-503): assemble already-processed
// pages into a valid CBZ archive in chapter order (RFC §5, CLAUDE.md §3).
//
// Per CLAUDE.md §4.4 the adapter is exercised for real — the produced archive
// is verified by the system `unzip` (a standard archive reader), not by
// round-tripping through the same library that wrote it. That is what proves
// "openable by a standard reader". The real builder lands in API-504; until
// then the stub throws and every assertion below stays red.
//
// Contract:
//   - the output is a valid ZIP/CBZ a standard tool accepts (`unzip -t`)
//   - one archive entry per page; page bytes stored verbatim (no re-encode)
//   - entries are named so a reader's lexicographic order == chapter order,
//     including past the 9→10 boundary (zero-padding, not "1.png".."10.png")
//   - entry file extension is derived from each page's content type
//   - the interface is mockable for upstream tests (API-505)

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "komanga-cbz-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * A distinct solid-colour image for page `index`, so every page's bytes are
 * unique and recoverable after extraction (lets us prove ordering by content,
 * not just by count).
 */
function pageImage(
  index: number,
  format: "png" | "jpeg" | "webp" = "png",
): Promise<Buffer> {
  const background = {
    r: (index * 37) % 256,
    g: (index * 91) % 256,
    b: (index * 53) % 256,
  };
  return sharp({ create: { width: 8, height: 8, channels: 3, background } })
    .toFormat(format)
    .toBuffer();
}

const CONTENT_TYPE = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
} as const;

async function pages(count: number): Promise<CbzPage[]> {
  return Promise.all(
    Array.from({ length: count }, async (_unused, i) => ({
      bytes: await pageImage(i),
      contentType: CONTENT_TYPE.png,
    })),
  );
}

/**
 * Extracts the archive with the system `unzip` (throws if it is not a valid
 * archive) and returns its entries in the lexicographic filename order a reader
 * would display them in.
 */
function extract(archive: Buffer): Array<{ name: string; bytes: Buffer }> {
  const dir = mkdtempSync(join(tmpDir, "extract-"));
  const file = join(dir, "archive.cbz");
  writeFileSync(file, archive);

  // Integrity check — `unzip -t` exits non-zero (throws) on a corrupt archive.
  execFileSync("unzip", ["-t", file], { stdio: "pipe" });

  const out = join(dir, "out");
  mkdirSync(out);
  execFileSync("unzip", ["-o", "-q", file, "-d", out], { stdio: "pipe" });

  return readdirSync(out)
    .sort()
    .map((name) => ({ name, bytes: readFileSync(join(out, name)) }));
}

describe("ZipCbzBuilder (CbzBuilder port contract)", () => {
  it("produces an archive a standard unzip tool accepts as valid", async () => {
    const builder = new ZipCbzBuilder();

    const archive = await builder.build(await pages(3));

    // extract() runs `unzip -t`, which throws on an invalid archive.
    expect(() => extract(archive)).not.toThrow();
  });

  it("stores exactly one entry per page", async () => {
    const builder = new ZipCbzBuilder();
    const input = await pages(5);

    const entries = extract(await builder.build(input));

    expect(entries).toHaveLength(5);
  });

  it("stores each page's bytes verbatim (no re-encoding)", async () => {
    const builder = new ZipCbzBuilder();
    const input = await pages(3);

    const entries = extract(await builder.build(input));

    for (let i = 0; i < input.length; i++) {
      expect(entries[i].bytes.equals(input[i].bytes)).toBe(true);
    }
  });

  it("names entries so a reader's order matches chapter order", async () => {
    // 12 pages so the 9→10 boundary matters: "1.png".."12.png" would sort
    // 1,10,11,12,2,... — only zero-padded names keep lexicographic == chapter
    // order, which is how a standard reader presents pages.
    const builder = new ZipCbzBuilder();
    const input = await pages(12);

    const entries = extract(await builder.build(input));

    expect(entries).toHaveLength(12);
    for (let i = 0; i < input.length; i++) {
      expect(entries[i].bytes.equals(input[i].bytes)).toBe(true);
    }
  });

  it("derives each entry's file extension from its content type", async () => {
    const builder = new ZipCbzBuilder();
    const input: CbzPage[] = [
      { bytes: await pageImage(0, "png"), contentType: CONTENT_TYPE.png },
      { bytes: await pageImage(1, "jpeg"), contentType: CONTENT_TYPE.jpeg },
      { bytes: await pageImage(2, "webp"), contentType: CONTENT_TYPE.webp },
    ];

    const entries = extract(await builder.build(input));

    // Order preserved, and the extension reflects each page's format.
    expect(entries[0].name.toLowerCase()).toMatch(/\.png$/);
    expect(entries[1].name.toLowerCase()).toMatch(/\.jpe?g$/);
    expect(entries[2].name.toLowerCase()).toMatch(/\.webp$/);
    for (let i = 0; i < input.length; i++) {
      expect(entries[i].bytes.equals(input[i].bytes)).toBe(true);
    }
  });

  it("builds a valid single-page archive", async () => {
    const builder = new ZipCbzBuilder();
    const input = await pages(1);

    const entries = extract(await builder.build(input));

    expect(entries).toHaveLength(1);
    expect(entries[0].bytes.equals(input[0].bytes)).toBe(true);
  });

  it("exposes a mockable interface for upstream tests", async () => {
    // Proves the port can stand in for the concrete adapter (API-505) — passes
    // green: it asserts the interface shape, not the unimplemented behaviour.
    const stub: CbzBuilder = {
      build: async () => Buffer.from("PK\x03\x04"),
    };

    const result = await stub.build(await pages(2));

    expect(Buffer.isBuffer(result)).toBe(true);
  });
});

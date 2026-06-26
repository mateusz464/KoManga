// Concrete CbzBuilder adapter (API-504): assembles already-processed pages into
// a CBZ — a plain ZIP whose entries are the page images. A reader displays
// entries in lexicographic filename order, so entries are named with
// zero-padded sequential numbers to make that order match chapter order.
//
// Pages have already been through the ImageProcessor, so they are stored with
// the ZIP STORE method (no compression): the archived bytes are the source
// bytes verbatim, exactly as the API-503 contract requires, and recompressing
// already-compressed images would only waste CPU.

import type { CbzBuilder, CbzPage } from "../../services/ports/cbz-builder.js";

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_VERSION = 20; // 2.0 — minimum for the STORE method
const METHOD_STORE = 0;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Maps a content type to a conventional file extension for the entry name. */
function extensionFor(contentType: string): string {
  const subtype =
    contentType.split(";")[0].trim().split("/")[1]?.toLowerCase() ?? "";
  if (subtype === "jpeg") return "jpg";
  return subtype || "bin";
}

export class ZipCbzBuilder implements CbzBuilder {
  build(pages: readonly CbzPage[]): Promise<Buffer> {
    // Zero-pad to the width of the largest index so the lexicographic order of
    // the names matches chapter order even past the 9→10 boundary.
    const width = String(pages.length).length;

    const parts: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;

    pages.forEach((page, i) => {
      const name = Buffer.from(
        `${String(i + 1).padStart(width, "0")}.${extensionFor(page.contentType)}`,
        "ascii",
      );
      const data = page.bytes;
      const crc = crc32(data);

      parts.push(localHeader(name, crc, data.length), data);
      central.push(centralHeader(name, crc, data.length, offset));
      offset += 30 + name.length + data.length;
    });

    const centralBuf = Buffer.concat(central);
    parts.push(
      centralBuf,
      endOfCentralDirectory(pages.length, centralBuf.length, offset),
    );

    return Promise.resolve(Buffer.concat(parts));
  }
}

function localHeader(name: Buffer, crc: number, size: number): Buffer {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(LOCAL_FILE_HEADER, 0);
  h.writeUInt16LE(ZIP_VERSION, 4);
  h.writeUInt16LE(0, 6); // general-purpose flags
  h.writeUInt16LE(METHOD_STORE, 8);
  h.writeUInt16LE(0, 10); // mod time
  h.writeUInt16LE(0, 12); // mod date
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(size, 18); // compressed size (== size for STORE)
  h.writeUInt32LE(size, 22); // uncompressed size
  h.writeUInt16LE(name.length, 26);
  h.writeUInt16LE(0, 28); // extra field length
  return Buffer.concat([h, name]);
}

function centralHeader(
  name: Buffer,
  crc: number,
  size: number,
  localOffset: number,
): Buffer {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(CENTRAL_FILE_HEADER, 0);
  h.writeUInt16LE(ZIP_VERSION, 4); // version made by
  h.writeUInt16LE(ZIP_VERSION, 6); // version needed
  h.writeUInt16LE(0, 8); // general-purpose flags
  h.writeUInt16LE(METHOD_STORE, 10);
  h.writeUInt16LE(0, 12); // mod time
  h.writeUInt16LE(0, 14); // mod date
  h.writeUInt32LE(crc, 16);
  h.writeUInt32LE(size, 20); // compressed size
  h.writeUInt32LE(size, 24); // uncompressed size
  h.writeUInt16LE(name.length, 28);
  h.writeUInt16LE(0, 30); // extra field length
  h.writeUInt16LE(0, 32); // comment length
  h.writeUInt16LE(0, 34); // disk number start
  h.writeUInt16LE(0, 36); // internal attributes
  h.writeUInt32LE(0, 38); // external attributes
  h.writeUInt32LE(localOffset, 42);
  return Buffer.concat([h, name]);
}

function endOfCentralDirectory(
  count: number,
  centralSize: number,
  centralOffset: number,
): Buffer {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(count, 8); // entries on this disk
  eocd.writeUInt16LE(count, 10); // total entries
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  return eocd;
}

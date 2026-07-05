import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { SharpImageProcessor } from "../../../src/adapters/images/sharp-image-processor.js";
import type {
  EinkProfileOptions,
  SourceImage,
} from "../../../src/services/ports/image-processor.js";

// The adapter exercised against real fixture images through the real `sharp`
// library. Two profiles: `raw` passes source bytes through unchanged; `eink`
// greyscales, fits within the configured target dimensions, and encodes in the
// configured format — all driven from config, never hardcoded.

const KOBO_EINK: EinkProfileOptions = {
  targetWidth: 1072,
  targetHeight: 1448,
  format: "png",
};

/**
 * A colour fixture whose three channels deliberately differ at every pixel, so
 * a greyscale assertion can't pass by accident on already-grey input.
 */
async function colourImage(
  width: number,
  height: number,
  format: "png" | "jpeg" | "webp" = "png",
): Promise<Buffer> {
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      data[i] = x % 256;
      data[i + 1] = y % 256;
      data[i + 2] = (x + y) % 256;
    }
  }
  return sharp(data, { raw: { width, height, channels } })
    .toFormat(format)
    .toBuffer();
}

async function source(width: number, height: number): Promise<SourceImage> {
  return { bytes: await colourImage(width, height), contentType: "image/png" };
}

/** True when every decoded pixel is grey (R == G == B), or the image is 1-channel. */
async function isGreyscale(bytes: Buffer): Promise<boolean> {
  const { data, info } = await sharp(bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels === 1) return true;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] !== data[i + 1] || data[i + 1] !== data[i + 2]) return false;
  }
  return true;
}

describe("SharpImageProcessor (ImageProcessor port contract)", () => {
  describe("raw profile", () => {
    it("returns the source bytes unchanged", async () => {
      const src = await source(1000, 1500);
      const processor = new SharpImageProcessor(KOBO_EINK);

      const result = await processor.process(src, "raw");

      expect(result.bytes.equals(src.bytes)).toBe(true);
    });

    it("preserves the source content type", async () => {
      const src = await source(1000, 1500);
      const processor = new SharpImageProcessor(KOBO_EINK);

      const result = await processor.process(src, "raw");

      expect(result.contentType).toBe("image/png");
    });

    it("does not apply the eink transform (stays colour, full size)", async () => {
      const src = await source(2000, 3000);
      const processor = new SharpImageProcessor(KOBO_EINK);

      const result = await processor.process(src, "raw");
      const meta = await sharp(result.bytes).metadata();

      expect(await isGreyscale(result.bytes)).toBe(false);
      expect(meta.width).toBe(2000);
      expect(meta.height).toBe(3000);
    });
  });

  describe("eink profile", () => {
    it("produces a greyscale image", async () => {
      const src = await source(1000, 1500);
      const processor = new SharpImageProcessor(KOBO_EINK);

      const result = await processor.process(src, "eink");

      expect(await isGreyscale(result.bytes)).toBe(true);
    });

    it("fits the output within the configured target dimensions", async () => {
      const src = await source(3000, 4000);
      const processor = new SharpImageProcessor(KOBO_EINK);

      const result = await processor.process(src, "eink");
      const meta = await sharp(result.bytes).metadata();

      expect(meta.width).toBeLessThanOrEqual(KOBO_EINK.targetWidth);
      expect(meta.height).toBeLessThanOrEqual(KOBO_EINK.targetHeight);
    });

    it("preserves the source aspect ratio (resize-to-fit, not stretch)", async () => {
      const src = await source(1000, 1500); // 2:3
      const processor = new SharpImageProcessor(KOBO_EINK);

      const result = await processor.process(src, "eink");
      const meta = await sharp(result.bytes).metadata();

      const sourceRatio = 1000 / 1500;
      const outputRatio = meta.width! / meta.height!;
      expect(Math.abs(outputRatio - sourceRatio)).toBeLessThan(0.02);
    });

    it("encodes in the configured output format with a matching content type", async () => {
      const src = await source(1000, 1500);
      const processor = new SharpImageProcessor(KOBO_EINK);

      const result = await processor.process(src, "eink");
      const meta = await sharp(result.bytes).metadata();

      expect(meta.format).toBe("png");
      expect(result.contentType).toBe("image/png");
    });
  });

  describe("target resolution and format come from config (not hardcoded)", () => {
    it("honours different target dimensions", async () => {
      const src = await source(1000, 1500);
      const processor = new SharpImageProcessor({
        targetWidth: 200,
        targetHeight: 300,
        format: "png",
      });

      const result = await processor.process(src, "eink");
      const meta = await sharp(result.bytes).metadata();

      expect(meta.width).toBeLessThanOrEqual(200);
      expect(meta.height).toBeLessThanOrEqual(300);
    });

    it("honours the jpeg output format", async () => {
      const src = await source(1000, 1500);
      const processor = new SharpImageProcessor({
        targetWidth: 1072,
        targetHeight: 1448,
        format: "jpeg",
      });

      const result = await processor.process(src, "eink");
      const meta = await sharp(result.bytes).metadata();

      expect(meta.format).toBe("jpeg");
      expect(result.contentType).toBe("image/jpeg");
      expect(await isGreyscale(result.bytes)).toBe(true);
    });

    // webp is intentionally NOT a valid eink output format (KWC-102: the Kobo
    // panel can't decode it) — png and jpeg above are the only supported set.
  });
});

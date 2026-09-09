/**
 * Test-side PNG decoder and pixel-comparison helpers.
 *
 * Used by the raw-export browser test to prove the DOWNLOADED PNGs are
 * complete, non-empty, correctly sized rasters whose content associates with
 * the camera pose that produced them (pixel-level evidence, not "files
 * differ"). Decoding uses only node:zlib — no image dependency — and verifies
 * every chunk CRC, so a truncated or corrupt PNG fails loudly.
 *
 * Supports exactly what Chrome's canvas.toBlob('image/png') emits: 8-bit
 * non-interlaced RGB (color type 2) or RGBA (color type 6).
 */
import { crc32 as nodeCrc32, inflateSync } from "node:zlib";

export interface DecodedPng {
  width: number;
  height: number;
  channels: 3 | 4;
  /** Row-major pixels, width*height*channels bytes, filter bytes removed. */
  pixels: Buffer;
}

const PNG_SIGNATURE = 0x89504e47;

export function decodePng(png: Buffer): DecodedPng {
  if (png.readUInt32BE(0) !== PNG_SIGNATURE || png.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error("not a PNG: signature mismatch");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels: 3 | 4 | null = null;
  const idat: Buffer[] = [];
  let sawIend = false;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    const storedCrc = png.readUInt32BE(offset + 8 + length);
    const actualCrc = Number(nodeCrc32(png.subarray(offset + 4, offset + 8 + length))) >>> 0;
    if (actualCrc !== storedCrc) {
      throw new Error(`PNG chunk ${type} fails its CRC check (corrupt or truncated file)`);
    }
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const compression = data[10];
      const filterMethod = data[11];
      const interlace = data[12];
      if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
      if (colorType !== 6 && colorType !== 2) {
        throw new Error(`unsupported PNG color type ${colorType} (need RGB/RGBA)`);
      }
      channels = colorType === 6 ? 4 : 3;
      if (compression !== 0 || filterMethod !== 0)
        throw new Error("unsupported PNG compression/filter");
      if (interlace !== 0) throw new Error("interlaced PNG unsupported");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      sawIend = true;
      break;
    }
    offset += 12 + length;
  }
  if (channels === null || idat.length === 0 || !sawIend) {
    throw new Error("incomplete PNG: missing IHDR, IDAT or IEND");
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const expected = (stride + 1) * height;
  if (raw.length !== expected) {
    throw new Error(`PNG pixel data length ${raw.length} != expected ${expected}`);
  }
  const pixels = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  let position = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[position];
    position += 1;
    const row = Buffer.from(raw.subarray(position, position + stride));
    position += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x];
      const upLeft = x >= channels ? prev[x - channels] : 0;
      switch (filter) {
        case 0:
          break;
        case 1:
          row[x] = (row[x] + left) & 0xff;
          break;
        case 2:
          row[x] = (row[x] + up) & 0xff;
          break;
        case 3:
          row[x] = (row[x] + ((left + up) >> 1)) & 0xff;
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          row[x] = (row[x] + predictor) & 0xff;
          break;
        }
        default:
          throw new Error(`invalid PNG filter type ${filter} at row ${y}`);
      }
    }
    row.copy(pixels, y * stride);
    prev = row;
  }
  return { width, height, channels, pixels };
}

/** Mean absolute per-channel difference of two same-size images (0 = identical). */
export function meanAbsDiff(a: DecodedPng, b: DecodedPng): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`image sizes differ: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const pixels = a.width * a.height;
  let total = 0;
  for (let i = 0; i < pixels; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      total += Math.abs(a.pixels[i * a.channels + c] - b.pixels[i * b.channels + c]);
    }
  }
  return total / (pixels * 3);
}

/** Fraction of pixels whose max channel delta exceeds a threshold (0..1). */
export function changedPixelRatio(a: DecodedPng, b: DecodedPng, channelDeltaThreshold = 8): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`image sizes differ: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const pixels = a.width * a.height;
  let changed = 0;
  for (let i = 0; i < pixels; i += 1) {
    let delta = 0;
    for (let c = 0; c < 3; c += 1) {
      delta = Math.max(
        delta,
        Math.abs(a.pixels[i * a.channels + c] - b.pixels[i * b.channels + c]),
      );
    }
    if (delta > channelDeltaThreshold) changed += 1;
  }
  return changed / pixels;
}

export interface RegionStats {
  avgR: number;
  avgG: number;
  avgB: number;
  /** Blue-minus-red tilt of the region average (A-side mannequins tilt > 0). */
  blueMinusRed: number;
}

/** Average color over the central fraction of the image. */
export function centerRegionStats(image: DecodedPng, fraction = 0.2): RegionStats {
  const x0 = Math.floor((image.width * (1 - fraction)) / 2);
  const x1 = image.width - x0;
  const y0 = Math.floor((image.height * (1 - fraction)) / 2);
  const y1 = image.height - y0;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * image.width + x) * image.channels;
      r += image.pixels[index];
      g += image.pixels[index + 1];
      b += image.pixels[index + 2];
      count += 1;
    }
  }
  const avgR = r / count;
  const avgG = g / count;
  const avgB = b / count;
  return { avgR, avgG, avgB, blueMinusRed: avgB - avgR };
}

/** Luminance standard deviation: a structural "non-empty, not flat" check. */
export function lumaStdDev(image: DecodedPng): number {
  const pixels = image.width * image.height;
  let sum = 0;
  let sumSquares = 0;
  for (let i = 0; i < pixels; i += 1) {
    const index = i * image.channels;
    const luma = (image.pixels[index] + image.pixels[index + 1] + image.pixels[index + 2]) / 3;
    sum += luma;
    sumSquares += luma * luma;
  }
  const mean = sum / pixels;
  return Math.sqrt(Math.max(0, sumSquares / pixels - mean * mean));
}

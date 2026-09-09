/**
 * Test-side, production-independent ZIP reader for STORE-only archives.
 *
 * Used by the unit suite (to verify the writer's output structure) and by the
 * raw-export browser test (to verify the archive the application actually
 * downloads). It deliberately re-implements parsing instead of sharing code
 * with src/features/export-package/zip-store.ts, and it verifies every
 * entry's CRC-32 against node:zlib.crc32 — an implementation independent of
 * both the writer and WebCrypto.
 */
import { crc32 as nodeCrc32 } from "node:zlib";

export interface ZipEntryInfo {
  name: string;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  data: Buffer;
}

const EOCD_SIGNATURE = 0x06054b50;
const CDH_SIGNATURE = 0x02014b50;
const LFH_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_COMMENT = 0xffff;

export function readStoreZip(buffer: Buffer): ZipEntryInfo[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (centralDirectoryOffset + centralDirectorySize !== eocdOffset) {
    throw new Error(
      `central directory (offset ${centralDirectoryOffset}, size ${centralDirectorySize}) ` +
        `does not end at the EOCD (${eocdOffset})`,
    );
  }

  const entries: ZipEntryInfo[] = [];
  let position = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(position) !== CDH_SIGNATURE) {
      throw new Error(
        `central directory entry ${index} at ${position} has no PK\\x01\\x02 signature`,
      );
    }
    const compressionMethod = buffer.readUInt16LE(position + 10);
    const crc = buffer.readUInt32LE(position + 16) >>> 0;
    const compressedSize = buffer.readUInt32LE(position + 20);
    const uncompressedSize = buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const localHeaderOffset = buffer.readUInt32LE(position + 42);
    const name = buffer.subarray(position + 46, position + 46 + nameLength).toString("utf8");
    position += 46 + nameLength + extraLength + commentLength;

    if (buffer.readUInt32LE(localHeaderOffset) !== LFH_SIGNATURE) {
      throw new Error(
        `local header for "${name}" at ${localHeaderOffset} has no PK\\x03\\x04 signature`,
      );
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const localName = buffer
      .subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLength)
      .toString("utf8");
    if (localName !== name) {
      throw new Error(`central ("${name}") and local ("${localName}") names disagree`);
    }
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    if (data.length !== compressedSize) {
      throw new Error(
        `entry "${name}" is truncated: expected ${compressedSize} bytes, got ${data.length}`,
      );
    }
    const actualCrc = Number(nodeCrc32(data)) >>> 0;
    if (actualCrc !== crc) {
      throw new Error(
        `CRC-32 mismatch for "${name}": central record ${crc}, recomputed ${actualCrc}`,
      );
    }
    entries.push({
      name,
      compressionMethod,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      data: Buffer.from(data),
    });
  }
  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  for (
    let offset = buffer.length - EOCD_MIN_SIZE;
    offset >= Math.max(0, buffer.length - EOCD_MIN_SIZE - EOCD_MAX_COMMENT);
    offset -= 1
  ) {
    if (
      buffer.readUInt32LE(offset) === EOCD_SIGNATURE &&
      buffer.readUInt16LE(offset + 20) === buffer.length - offset - EOCD_MIN_SIZE
    ) {
      return offset;
    }
  }
  throw new Error("end-of-central-directory record not found");
}

/**
 * Deterministic STORE-only ZIP writer (Prompt 5 / Phase 1 Day 5).
 *
 * The raw export package contains five small files, so compression is not
 * needed; writing the STORE (method 0) form directly keeps the archive
 * byte-deterministic for one set of entries plus one injected timestamp —
 * no dependency is added (docs/ARCHITECTURE.md names "JSZip or server-side
 * equivalent" as the default choice; the Day 5 decision to use a small
 * in-repo writer instead is recorded there).
 *
 * Format: PKZIP APPNOTE local file headers + central directory + EOCD, with
 * the UTF-8 name flag (0x0800) set and DOS date/time fields derived from the
 * caller-provided timestamp (years before 1980 are rejected — the DOS format
 * cannot represent them).
 *
 * This module is pure TypeScript: no React, no Three.js, no browser API, so
 * it is unit-testable in plain Node. Unit tests cross-check the CRC32
 * implementation against node:zlib.crc32 and re-parse the archive.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const VERSION_NEEDED_TO_EXTRACT = 20; // 2.0: directories / standard entries
const GENERAL_PURPOSE_FLAGS = 0x0800; // UTF-8 filenames
const COMPRESSION_METHOD_STORE = 0;
const LOCAL_FILE_HEADER_SIZE = 30;
const CENTRAL_DIRECTORY_HEADER_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;

/**
 * Builds a STORE-only ZIP archive. Entry order is preserved exactly as given
 * (callers pass the documented archive layout). Duplicate or empty entry
 * names are rejected.
 */
export function buildStoreZip(entries: readonly ZipEntry[], timestamp: Date): Uint8Array {
  if (entries.length === 0) {
    throw new Error("a ZIP archive requires at least one entry");
  }
  const seenNames = new Set<string>();
  for (const entry of entries) {
    if (entry.name.length === 0) {
      throw new Error("ZIP entry names must not be empty");
    }
    if (seenNames.has(entry.name)) {
      throw new Error(`duplicate ZIP entry name: ${entry.name}`);
    }
    seenNames.add(entry.name);
  }

  const encoder = new TextEncoder();
  const encoded = entries.map((entry) => ({
    name: encoder.encode(entry.name),
    data: entry.data,
    crc32: crc32(entry.data),
  }));
  const dosTime = toDosTime(timestamp);
  const dosDate = toDosDate(timestamp);

  let totalSize = END_OF_CENTRAL_DIRECTORY_SIZE;
  for (const entry of encoded) {
    totalSize += LOCAL_FILE_HEADER_SIZE + entry.name.byteLength + entry.data.byteLength;
    totalSize += CENTRAL_DIRECTORY_HEADER_SIZE + entry.name.byteLength;
  }

  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);
  let offset = 0;
  const centralDirectoryOffsets: number[] = [];

  for (const entry of encoded) {
    centralDirectoryOffsets.push(offset);
    view.setUint32(offset, LOCAL_FILE_HEADER_SIGNATURE, true);
    view.setUint16(offset + 4, VERSION_NEEDED_TO_EXTRACT, true);
    view.setUint16(offset + 6, GENERAL_PURPOSE_FLAGS, true);
    view.setUint16(offset + 8, COMPRESSION_METHOD_STORE, true);
    view.setUint16(offset + 10, dosTime, true);
    view.setUint16(offset + 12, dosDate, true);
    view.setUint32(offset + 14, entry.crc32, true);
    view.setUint32(offset + 18, entry.data.byteLength, true); // compressed
    view.setUint32(offset + 22, entry.data.byteLength, true); // uncompressed
    view.setUint16(offset + 26, entry.name.byteLength, true);
    view.setUint16(offset + 28, 0, true); // extra field length
    offset += LOCAL_FILE_HEADER_SIZE;
    output.set(entry.name, offset);
    offset += entry.name.byteLength;
    output.set(entry.data, offset);
    offset += entry.data.byteLength;
  }

  const centralDirectoryStart = offset;
  for (let index = 0; index < encoded.length; index += 1) {
    const entry = encoded[index];
    view.setUint32(offset, CENTRAL_DIRECTORY_HEADER_SIGNATURE, true);
    view.setUint16(offset + 4, VERSION_NEEDED_TO_EXTRACT, true); // made by
    view.setUint16(offset + 6, VERSION_NEEDED_TO_EXTRACT, true); // needed
    view.setUint16(offset + 8, GENERAL_PURPOSE_FLAGS, true);
    view.setUint16(offset + 10, COMPRESSION_METHOD_STORE, true);
    view.setUint16(offset + 12, dosTime, true);
    view.setUint16(offset + 14, dosDate, true);
    view.setUint32(offset + 16, entry.crc32, true);
    view.setUint32(offset + 20, entry.data.byteLength, true);
    view.setUint32(offset + 24, entry.data.byteLength, true);
    view.setUint16(offset + 28, entry.name.byteLength, true);
    view.setUint16(offset + 30, 0, true); // extra field length
    view.setUint16(offset + 32, 0, true); // comment length
    view.setUint16(offset + 34, 0, true); // disk number start
    view.setUint16(offset + 36, 0, true); // internal attributes
    view.setUint32(offset + 38, 0, true); // external attributes
    view.setUint32(offset + 42, centralDirectoryOffsets[index], true);
    offset += CENTRAL_DIRECTORY_HEADER_SIZE;
    output.set(entry.name, offset);
    offset += entry.name.byteLength;
  }
  const centralDirectorySize = offset - centralDirectoryStart;

  view.setUint32(offset, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(offset + 4, 0, true); // this disk
  view.setUint16(offset + 6, 0, true); // central directory disk
  view.setUint16(offset + 8, encoded.length, true);
  view.setUint16(offset + 10, encoded.length, true);
  view.setUint32(offset + 12, centralDirectorySize, true);
  view.setUint32(offset + 16, centralDirectoryStart, true);
  view.setUint16(offset + 20, 0, true); // comment length

  return output;
}

/** Standard CRC-32 (IEEE 802.3, reflected, init/final 0xffffffff). */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function toDosTime(timestamp: Date): number {
  return (
    (timestamp.getHours() << 11) | (timestamp.getMinutes() << 5) | (timestamp.getSeconds() >> 1)
  );
}

function toDosDate(timestamp: Date): number {
  const year = timestamp.getFullYear();
  if (year < 1980) {
    throw new RangeError(`ZIP DOS timestamps cannot represent years before 1980; got ${year}`);
  }
  return ((year - 1980) << 9) | ((timestamp.getMonth() + 1) << 5) | timestamp.getDate();
}

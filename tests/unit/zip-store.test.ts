import { crc32 as nodeCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";

import { buildStoreZip, crc32, type ZipEntry } from "../../src/features/export-package/zip-store";
import { readStoreZip } from "../helpers/zip-reader";

/**
 * STORE-only ZIP writer (Prompt 5 / Phase 1 Day 5). CRC-32 is cross-checked
 * against node:zlib.crc32 and the archive structure against the independent
 * test-side parser in tests/helpers/zip-reader.ts (which also verifies every
 * entry CRC and local/central header agreement).
 */

const TIMESTAMP = new Date("2026-09-09T12:34:56.000Z");

const ENTRIES: ZipEntry[] = [
  { name: "shot-state.json", data: new TextEncoder().encode('{"id":"abc"}') },
  {
    name: "composition-raw.png",
    data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { name: "empty.bin", data: new Uint8Array(0) },
];

describe("crc32", () => {
  it("matches node:zlib.crc32 across empty, text and binary inputs", () => {
    const inputs = [
      new Uint8Array(0),
      new TextEncoder().encode("hello world"),
      new TextEncoder().encode("shot-state.json"),
      new Uint8Array(Array.from({ length: 256 }, (_, index) => index)),
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0x7f]),
    ];
    for (const input of inputs) {
      expect(crc32(input)).toBe(Number(nodeCrc32(input)) >>> 0);
    }
  });
});

describe("buildStoreZip", () => {
  it("produces a structurally valid archive the independent reader can walk", () => {
    const zip = buildStoreZip(ENTRIES, TIMESTAMP);
    const entries = readStoreZip(Buffer.from(zip));
    expect(entries.map((entry) => entry.name)).toEqual(ENTRIES.map((entry) => entry.name));
    for (let index = 0; index < entries.length; index += 1) {
      expect(entries[index].compressionMethod).toBe(0);
      expect(entries[index].compressedSize).toBe(ENTRIES[index].data.byteLength);
      expect(entries[index].uncompressedSize).toBe(ENTRIES[index].data.byteLength);
      expect(Buffer.compare(entries[index].data, Buffer.from(ENTRIES[index].data))).toBe(0);
    }
  });

  it("round-trips the stored bytes through central directory and local headers", () => {
    const zip = buildStoreZip(ENTRIES, TIMESTAMP);
    const entries = readStoreZip(Buffer.from(zip));
    const state = entries.find((entry) => entry.name === "shot-state.json");
    expect(state?.data.toString("utf8")).toBe('{"id":"abc"}');
    const png = entries.find((entry) => entry.name === "composition-raw.png");
    expect(png?.data[0]).toBe(0x89);
    expect(png?.data.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("is byte-deterministic for identical entries and timestamp", () => {
    const first = Buffer.from(buildStoreZip(ENTRIES, TIMESTAMP));
    const second = Buffer.from(buildStoreZip(ENTRIES, TIMESTAMP));
    expect(Buffer.compare(first, second)).toBe(0);
  });

  it("changes bytes when the timestamp changes (DOS date/time fields)", () => {
    const first = Buffer.from(buildStoreZip(ENTRIES, TIMESTAMP));
    const second = Buffer.from(buildStoreZip(ENTRIES, new Date("2026-09-10T08:00:02.000Z")));
    expect(Buffer.compare(first, second)).not.toBe(0);
  });

  it("rejects degenerate inputs instead of emitting a broken archive", () => {
    expect(() => buildStoreZip([], TIMESTAMP)).toThrow("at least one entry");
    expect(() =>
      buildStoreZip(
        [
          { name: "a.txt", data: new Uint8Array(1) },
          { name: "a.txt", data: new Uint8Array(2) },
        ],
        TIMESTAMP,
      ),
    ).toThrow("duplicate ZIP entry name");
    expect(() => buildStoreZip([{ name: "", data: new Uint8Array(1) }], TIMESTAMP)).toThrow(
      "must not be empty",
    );
    // DOS date fields cannot represent years before 1980.
    expect(() => buildStoreZip(ENTRIES, new Date("1970-01-01T00:00:00.000Z"))).toThrow(RangeError);
  });
});

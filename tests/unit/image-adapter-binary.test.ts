import { describe, expect, it } from "vitest";

import {
  base64ToBytes,
  bytesToBase64,
  blobToDataUrl,
  dataUrlToBytes,
} from "../../src/adapters/image-generation/binary";

describe("image-adapter binary helpers", () => {
  it("base64 round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 128, 7]);
    const roundTripped = base64ToBytes(bytesToBase64(bytes));
    expect([...roundTripped]).toEqual([...bytes]);
  });

  it("handles the empty and large cases", () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array([])))).toEqual(new Uint8Array([]));
    const large = new Uint8Array(20_000).map((_, index) => index % 256);
    expect([...base64ToBytes(bytesToBase64(large))]).toEqual([...large]);
  });

  it("blobToDataUrl and dataUrlToBytes round-trip with the mime type preserved", async () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const blob = new Blob([bytes as BlobPart], { type: "image/png" });
    const dataUrl = await blobToDataUrl(blob);
    expect(dataUrl).toBe(`data:image/png;base64,${bytesToBase64(bytes)}`);
    const decoded = dataUrlToBytes(dataUrl);
    expect(decoded).not.toBeNull();
    expect(decoded!.mimeType).toBe("image/png");
    expect([...decoded!.bytes]).toEqual([...bytes]);
  });

  it("dataUrlToBytes rejects non-data URLs", () => {
    expect(dataUrlToBytes("https://example.com/image.png")).toBeNull();
    expect(dataUrlToBytes("data:text/plain,hello")).toBeNull();
  });
});

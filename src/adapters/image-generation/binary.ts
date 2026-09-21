/**
 * Binary transport helpers shared by the enhanced-frame server core and the
 * production image adapters (Prompt 7B2). Pure Web-standard code — no Node
 * APIs, no Buffer — so the same helpers run in the route handler, in vitest
 * and in the browser if ever needed.
 */

/** Chunked base64 encoding (8-bit-safe in every runtime; no Buffer dependency). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8_192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** Base64 decoding into bytes (standard alphabet, as used by every provider here). */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Reads a Blob as a `data:<mime>;base64,...` URL (Ark and DashScope both accept these). */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = blob.type === "" ? "application/octet-stream" : blob.type;
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** Splits a data URL back into bytes; returns null for anything else. */
export function dataUrlToBytes(value: string): { bytes: Uint8Array; mimeType: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value);
  if (match === null) {
    return null;
  }
  return { bytes: base64ToBytes(match[2]!), mimeType: match[1]! };
}

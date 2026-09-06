import type { GeneratedImageArtifact, ImageGenerationAdapter, ImageGenerationInput } from "./types";

/**
 * Deterministic mock image-generation adapter.
 *
 * Constraints (Prompt 1):
 * - no network access;
 * - no environment variables or credentials;
 * - output is a pure function of the input;
 * - suitable as the default adapter for development and CI.
 */

export const MOCK_IMAGE_ADAPTER_ID = "mock-image-generation";
export const MOCK_IMAGE_ADAPTER_VERSION = "1.0.0";

/**
 * FNV-1a 32-bit hash; used only to make mock output depend deterministically
 * on input content. Not a security primitive.
 */
function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

async function blobSignature(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  return fnv1a(buffer);
}

async function inputSignature(input: ImageGenerationInput): Promise<string> {
  const parts: string[] = [
    input.prompt,
    await blobSignature(input.compositionImage),
    input.characterReferences
      ? (await Promise.all(input.characterReferences.map(blobSignature))).join(",")
      : "",
    input.styleReference ? await blobSignature(input.styleReference) : "",
  ];
  return fnv1a(new TextEncoder().encode(parts.join("\u0000")));
}

export class MockImageGenerationAdapter implements ImageGenerationAdapter {
  readonly id = MOCK_IMAGE_ADAPTER_ID;
  readonly version = MOCK_IMAGE_ADAPTER_VERSION;

  async generate(input: ImageGenerationInput): Promise<GeneratedImageArtifact> {
    const signature = await inputSignature(input);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">` +
      `<rect width="64" height="64" fill="#eeeeee"/>` +
      `<text x="4" y="38" font-family="monospace" font-size="10">${signature}</text>` +
      `</svg>`;
    const image = new Blob([svg], { type: "image/svg+xml" });
    return {
      adapterId: this.id,
      adapterVersion: this.version,
      image,
      metadata: {
        signature,
        promptLengthBytes: String(new TextEncoder().encode(input.prompt).length),
        referenceCount: String(input.characterReferences?.length ?? 0),
        hasStyleReference: String(input.styleReference !== undefined),
      },
    };
  }
}

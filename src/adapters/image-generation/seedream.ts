/**
 * Doubao-Seedream adapter (Volcengine Ark) — Prompt 7B2 production adapter,
 * the D027 PRIMARY image provider.
 *
 * Transport: plain REST over fetch (see provider-http.ts for the SDK-exclusion
 * rationale). Endpoint and parameters follow the Ark image-generation API
 * (docs.volcengine.com/docs/82379/1541523); the request shape below is
 * cross-validated against multiple secondary sources because the official
 * page renders client-side (marked in docs/PROVIDER_SPIKE.md). Every provider
 * specific — base URL, model id, size — is constructor-overridable, so a
 * first-live-call correction touches exactly one default, and the contract
 * tests pin the adapter's own request/response mapping, not the provider.
 *
 * Mapping (see docs/ARCHITECTURE.md "Enhanced first-frame service"):
 * compositionImage -> image[0]; characterReferences follow; styleReference
 * last. Ark bills successful outputs only; failures never bill.
 */
import { z } from "zod";

import type { GeneratedImageArtifact, ImageGenerationAdapter, ImageGenerationInput } from "./types";

import { blobToDataUrl, base64ToBytes, bytesToBase64 } from "./binary";
import { postJsonForProvider } from "./provider-http";

export const SEEDREAM_ADAPTER_ID = "seedream";
export const SEEDREAM_ADAPTER_VERSION = "1.0.0";

export const SEEDREAM_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
/**
 * Default model: the developer's Ark console shows Doubao-Seedream-5.0-pro
 * (version tag 260628), selected 2026-09-22 — the ID follows Ark's
 * `doubao-seedream-<major>-<minor>[-pro]-<version>` convention. Override with
 * the SEEDREAM_MODEL env setting (e.g. `doubao-seedream-4-5-251128`) if the
 * exact string differs on the console's API page.
 */
export const SEEDREAM_DEFAULT_MODEL = "doubao-seedream-5-0-pro-260628";
/**
 * Size policy (live-verified 2026-09-22 against doubao-seedream-5-0-pro):
 * `size` must be an explicit `WIDTHxHEIGHT` or a supported preset — the
 * cross-validated "adaptive" guess is NOT accepted. The adapter therefore
 * derives `WIDTHxHEIGHT` from the composition PNG's own pixel dimensions
 * (which also matches the Seedance 720p first-frame raster the pipeline
 * exports); this constant is only the fallback when the composition is not a
 * parseable PNG. Explicit `size` options / SEEDREAM_SIZE always win.
 */
export const SEEDREAM_FALLBACK_SIZE = "1280x720";

/**
 * Reads the IHDR dimensions of a PNG byte stream (signature + chunk header +
 * big-endian width/height). Returns null for anything that is not a PNG with a
 * readable IHDR — the caller then falls back to the fixed default.
 */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24) {
    return null;
  }
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      return null;
    }
  }
  const chunkType = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunkType !== "IHDR") {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

/**
 * LIVE-VERIFIED Ark response shape (2026-09-22, doubao-seedream-5-0-pro):
 * the API returns extra metadata (top-level `model`/`created`; per-image
 * `size`/`output_format`). Provider responses therefore use TOLERANT objects
 * — every field we depend on is strictly validated, additional provider
 * metadata is captured where useful and ignored otherwise. (Our OWN data
 * contracts stay strictObject; tolerance is a provider-response policy.)
 */
const arkImageResponseSchema = z.object({
  model: z.string().optional(),
  created: z.number().optional(),
  data: z
    .array(
      z.object({
        b64_json: z.string().min(1),
        size: z.string().optional(),
        output_format: z.string().optional(),
      }),
    )
    .min(1),
  usage: z.unknown().optional(),
});

export interface SeedreamAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  size?: string;
  watermark?: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class SeedreamImageGenerationAdapter implements ImageGenerationAdapter {
  readonly id = SEEDREAM_ADAPTER_ID;
  readonly version = SEEDREAM_ADAPTER_VERSION;
  private readonly options: Required<Pick<SeedreamAdapterOptions, "baseUrl" | "model">> &
    SeedreamAdapterOptions;

  constructor(options: SeedreamAdapterOptions) {
    if (options.apiKey.trim() === "") {
      throw new Error("SeedreamImageGenerationAdapter requires a non-empty Ark API key");
    }
    this.options = {
      ...options,
      baseUrl: options.baseUrl ?? SEEDREAM_DEFAULT_BASE_URL,
      model: options.model ?? SEEDREAM_DEFAULT_MODEL,
      watermark: options.watermark ?? false,
    };
  }

  async generate(input: ImageGenerationInput): Promise<GeneratedImageArtifact> {
    const compositionBytes = new Uint8Array(await input.compositionImage.arrayBuffer());
    const dimensions =
      input.compositionImage.type === "image/png" ? pngDimensions(compositionBytes) : null;
    const size =
      this.options.size ??
      (dimensions !== null ? `${dimensions.width}x${dimensions.height}` : SEEDREAM_FALLBACK_SIZE);

    const images: string[] = [
      `data:${input.compositionImage.type};base64,${bytesToBase64(compositionBytes)}`,
    ];
    for (const reference of input.characterReferences ?? []) {
      images.push(await blobToDataUrl(reference));
    }
    if (input.styleReference !== undefined) {
      images.push(await blobToDataUrl(input.styleReference));
    }

    const body = {
      model: this.options.model,
      prompt: input.prompt,
      image: images,
      size,
      response_format: "b64_json",
      watermark: this.options.watermark ?? false,
    };

    const url = `${this.options.baseUrl}/images/generations`;
    const response = await postJsonForProvider(
      {
        url,
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      {
        schema: arkImageResponseSchema,
        timeoutMs: this.options.timeoutMs,
        maxAttempts: this.options.maxAttempts,
        fetchImpl: this.options.fetchImpl,
        sleep: this.options.sleep,
      },
    );

    const first = response.data[0]!;
    const bytes = base64ToBytes(first.b64_json);
    return {
      adapterId: this.id,
      adapterVersion: this.version,
      image: new Blob([bytes as BlobPart], { type: "image/png" }),
      metadata: {
        provider: "seedream",
        model: this.options.model,
        responseModel: response.model ?? "",
        outputFormat: first.output_format ?? "",
        responseSize: first.size ?? "",
        size,
        sizeSource:
          this.options.size !== undefined
            ? "explicit"
            : dimensions !== null
              ? "composition-png"
              : "fallback",
        endpoint: this.options.baseUrl,
        promptLengthBytes: String(new TextEncoder().encode(input.prompt).length),
        compositionBytes: String(input.compositionImage.size),
        referenceCount: String(input.characterReferences?.length ?? 0),
        hasStyleReference: String(input.styleReference !== undefined),
        watermark: String(this.options.watermark ?? false),
      },
    };
  }
}

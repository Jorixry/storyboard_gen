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

import { blobToDataUrl, base64ToBytes } from "./binary";
import { postJsonForProvider } from "./provider-http";

export const SEEDREAM_ADAPTER_ID = "seedream";
export const SEEDREAM_ADAPTER_VERSION = "1.0.0";

export const SEEDREAM_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
export const SEEDREAM_DEFAULT_MODEL = "doubao-seedream-4-0-250828";
/**
 * "adaptive" (follow the input composition's aspect ratio) is the
 * composition-preserving default; the official enum list is pending the
 * first live-call verification (docs/PROVIDER_SPIKE.md, UNCONFIRMED item).
 */
export const SEEDREAM_DEFAULT_SIZE = "adaptive";

const arkImageResponseSchema = z.strictObject({
  data: z.array(z.strictObject({ b64_json: z.string().min(1), url: z.string().optional() })).min(1),
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
  private readonly options: Required<Pick<SeedreamAdapterOptions, "baseUrl" | "model" | "size">> &
    SeedreamAdapterOptions;

  constructor(options: SeedreamAdapterOptions) {
    if (options.apiKey.trim() === "") {
      throw new Error("SeedreamImageGenerationAdapter requires a non-empty Ark API key");
    }
    this.options = {
      ...options,
      baseUrl: options.baseUrl ?? SEEDREAM_DEFAULT_BASE_URL,
      model: options.model ?? SEEDREAM_DEFAULT_MODEL,
      size: options.size ?? SEEDREAM_DEFAULT_SIZE,
      watermark: options.watermark ?? false,
    };
  }

  async generate(input: ImageGenerationInput): Promise<GeneratedImageArtifact> {
    const images: string[] = [await blobToDataUrl(input.compositionImage)];
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
      size: this.options.size,
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
        size: this.options.size,
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

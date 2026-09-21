/**
 * Wan 2.7 adapter (Alibaba Cloud Model Studio / DashScope) — Prompt 7B2
 * production adapter, the D027 BACKUP image provider.
 *
 * Transport: plain REST over fetch (see provider-http.ts). Uses the
 * SYNCHRONOUS multimodal-generation endpoint from the official API reference
 * (help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference,
 * fully captured in docs/PROVIDER_SPIKE.md) — no X-DashScope-Async header, no
 * task polling. The base URL defaults to the legacy dashscope.aliyuncs.com
 * domain; workspace-dedicated domains ({WorkspaceId}.cn-beijing.maas.aliyuncs.com)
 * are a constructor/env override, because the workspace id is account-specific.
 *
 * Ordering rule (official): with image input, the output aspect ratio follows
 * the LAST input image — so the composition frame is deliberately placed LAST
 * in the image array (character/style references first) to lock the exported
 * framing. Only successful outputs are billed.
 */
import { z } from "zod";

import type { GeneratedImageArtifact, ImageGenerationAdapter, ImageGenerationInput } from "./types";

import { blobToDataUrl, dataUrlToBytes } from "./binary";
import { postJsonForProvider } from "./provider-http";

export const WANXIANG_ADAPTER_ID = "wanxiang";
export const WANXIANG_ADAPTER_VERSION = "1.0.0";

export const WANXIANG_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
export const WANXIANG_DEFAULT_MODEL = "wan2.7-image";
export const WANXIANG_DEFAULT_SIZE = "2K";

/**
 * output.choices[].message.content[] carrying an image (data URI or URL).
 * Tolerant objects: fields we depend on are strictly validated; DashScope's
 * additional metadata fields (finish_reason etc.) are ignored — the same
 * provider-response policy live-verified against Ark on 2026-09-22, applied
 * proactively so the backup channel cannot hit the same class of failure.
 */
const dashscopeImageResponseSchema = z.object({
  output: z.object({
    choices: z
      .array(
        z.object({
          message: z.object({
            content: z.array(z.object({ image: z.string().min(1) })).min(1),
          }),
        }),
      )
      .min(1),
  }),
  request_id: z.string().optional(),
  usage: z.unknown().optional(),
});

export interface WanxiangAdapterOptions {
  apiKey: string;
  /** Legacy domain by default; set the workspace-dedicated domain here. */
  baseUrl?: string;
  model?: string;
  size?: string;
  watermark?: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class WanxiangImageGenerationAdapter implements ImageGenerationAdapter {
  readonly id = WANXIANG_ADAPTER_ID;
  readonly version = WANXIANG_ADAPTER_VERSION;
  private readonly options: Required<Pick<WanxiangAdapterOptions, "baseUrl" | "model" | "size">> &
    WanxiangAdapterOptions;

  constructor(options: WanxiangAdapterOptions) {
    if (options.apiKey.trim() === "") {
      throw new Error("WanxiangImageGenerationAdapter requires a non-empty DashScope API key");
    }
    this.options = {
      ...options,
      baseUrl: options.baseUrl ?? WANXIANG_DEFAULT_BASE_URL,
      model: options.model ?? WANXIANG_DEFAULT_MODEL,
      size: options.size ?? WANXIANG_DEFAULT_SIZE,
      watermark: options.watermark ?? false,
    };
  }

  async generate(input: ImageGenerationInput): Promise<GeneratedImageArtifact> {
    // Composition LAST: the output aspect ratio follows the last input image.
    const images: string[] = [];
    for (const reference of input.characterReferences ?? []) {
      images.push(await blobToDataUrl(reference));
    }
    if (input.styleReference !== undefined) {
      images.push(await blobToDataUrl(input.styleReference));
    }
    images.push(await blobToDataUrl(input.compositionImage));

    const body = {
      model: this.options.model,
      input: {
        messages: [
          {
            role: "user",
            text: input.prompt,
            image: images,
          },
        ],
      },
      parameters: {
        size: this.options.size,
        n: 1,
        watermark: this.options.watermark ?? false,
      },
    };

    const url = `${this.options.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`;
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
        schema: dashscopeImageResponseSchema,
        timeoutMs: this.options.timeoutMs,
        maxAttempts: this.options.maxAttempts,
        fetchImpl: this.options.fetchImpl,
        sleep: this.options.sleep,
      },
    );

    const image0 = response.output.choices[0]!.message.content[0]!.image;
    const inline = dataUrlToBytes(image0);
    let image: Blob;
    if (inline !== null) {
      image = new Blob([inline.bytes as BlobPart], { type: inline.mimeType });
    } else {
      // A plain URL: download the bytes through the same injectable fetch.
      const downloadResponse = await (this.options.fetchImpl ?? fetch)(image0);
      if (!downloadResponse.ok) {
        throw new Error(
          `wanxiang result image download failed with HTTP ${downloadResponse.status}`,
        );
      }
      image = await downloadResponse.blob();
    }

    return {
      adapterId: this.id,
      adapterVersion: this.version,
      image,
      metadata: {
        provider: "wanxiang",
        model: this.options.model,
        size: this.options.size,
        endpoint: this.options.baseUrl,
        requestId: response.request_id ?? "",
        promptLengthBytes: String(new TextEncoder().encode(input.prompt).length),
        compositionBytes: String(input.compositionImage.size),
        referenceCount: String(input.characterReferences?.length ?? 0),
        hasStyleReference: String(input.styleReference !== undefined),
        watermark: String(this.options.watermark ?? false),
      },
    };
  }
}

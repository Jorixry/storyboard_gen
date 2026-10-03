/**
 * Wan 2.7 adapter (Alibaba Cloud Model Studio / DashScope) — Prompt 7B2
 * production adapter, the D027 BACKUP image provider.
 *
 * Transport: plain REST over fetch (see provider-http.ts). Uses the
 * SYNCHRONOUS multimodal-generation endpoint from the official API reference
 * (help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference,
 * re-verified against the official page 2026-09-23). No X-DashScope-Async
 * header, no task polling. The base URL defaults to the legacy
 * dashscope.aliyuncs.com domain; workspace-dedicated domains
 * ({WorkspaceId}.cn-beijing.maas.aliyuncs.com) are a constructor/env override,
 * because the workspace id is account-specific.
 *
 * Request body (official contract, corrected 2026-09-23): the text prompt and
 * the input images are separate objects inside input.messages[0].content —
 * an array of {image: string} entries plus one {text: string} entry. There is
 * NO top-level messages[0].text or messages[0].image field. (The pre-fix
 * shape was a cross-written error, never live-verified.)
 *
 * Ordering rule (official): image order is defined by content-array position
 * and the output aspect ratio follows the LAST input image — so the
 * composition frame is deliberately placed as the LAST {image} object
 * (character/style references first), and the prompt text follows it.
 *
 * Cancellation (acceptance fix round 2026-09-23): the total-budget signal is
 * forwarded to the generation POST, and a plain-URL result image is downloaded
 * under the SAME budget — an expired budget aborts the download and never
 * starts a new one. Only successful outputs are billed.
 */
import { z } from "zod";

import type {
  GeneratedImageArtifact,
  ImageGenerationAdapter,
  ImageGenerationContext,
  ImageGenerationInput,
} from "./types";

import { blobToDataUrl, dataUrlToBytes } from "./binary";
import {
  ProviderResultDeliveryError,
  assertAllowedProviderUrl,
  postJsonForProvider,
} from "./provider-http";

export const WANXIANG_ADAPTER_ID = "wanxiang";
export const WANXIANG_ADAPTER_VERSION = "1.1.0";

export const WANXIANG_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
export const WANXIANG_DEFAULT_MODEL = "wan2.7-image";
export const WANXIANG_DEFAULT_SIZE = "2K";

/** Official input limit: 0–9 input images IN TOTAL (composition + refs + style). */
export const WANXIANG_MAX_INPUT_IMAGES = 9;

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

/** One content-array entry: an image (data URL or public URL) as its own object. */
interface ContentImage {
  image: string;
}

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

  async generate(
    input: ImageGenerationInput,
    context?: ImageGenerationContext,
  ): Promise<GeneratedImageArtifact> {
    const totalInputImages =
      1 + (input.characterReferences?.length ?? 0) + (input.styleReference !== undefined ? 1 : 0);
    if (totalInputImages > WANXIANG_MAX_INPUT_IMAGES) {
      throw new Error(
        `wanxiang accepts at most ${WANXIANG_MAX_INPUT_IMAGES} input images in total; got ${totalInputImages} ` +
          "(1 composition + character references + optional style reference)",
      );
    }

    // Composition LAST: the output aspect ratio follows the last input image.
    const images: string[] = [];
    for (const reference of input.characterReferences ?? []) {
      images.push(await blobToDataUrl(reference));
    }
    if (input.styleReference !== undefined) {
      images.push(await blobToDataUrl(input.styleReference));
    }
    images.push(await blobToDataUrl(input.compositionImage));

    const content: Array<ContentImage | { text: string }> = [
      ...images.map((image): ContentImage => ({ image })),
      { text: input.prompt },
    ];
    const body = {
      model: this.options.model,
      input: {
        messages: [
          {
            role: "user",
            content,
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
        signal: context?.signal,
        deadlineAt: context?.deadlineAt,
        fetchImpl: this.options.fetchImpl,
        sleep: this.options.sleep,
      },
    );

    const image0 = response.output.choices[0]!.message.content[0]!.image;
    // The generation itself already succeeded (2xx + contract): from here a
    // failure means the RESULT could not be delivered, not that nothing ran —
    // ProviderResultDeliveryError keeps that distinction and the charge
    // warning (acceptance R2-1).
    let inline: ReturnType<typeof dataUrlToBytes>;
    try {
      inline = dataUrlToBytes(image0);
    } catch (error) {
      throw new ProviderResultDeliveryError(
        `decoding the inline result image failed (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
    let image: Blob;
    if (inline !== null) {
      image = new Blob([inline.bytes as BlobPart], { type: inline.mimeType });
    } else {
      // A plain URL: download the bytes through the same injectable fetch,
      // under the SAME total budget (acceptance P1-3) — the download is
      // aborted when the budget expires and never starts after it has.
      try {
        assertAllowedProviderUrl(image0);
      } catch (error) {
        throw new ProviderResultDeliveryError(
          `the result URL was refused by the outbound URL policy (${
            error instanceof Error ? error.message : String(error)
          })`,
        );
      }
      context?.signal?.throwIfAborted();
      if (context?.deadlineAt !== undefined && context.deadlineAt - Date.now() <= 0) {
        throw new ProviderResultDeliveryError(
          "the result download was skipped because the total generation budget was exhausted",
        );
      }
      const downloadFetch = this.options.fetchImpl ?? fetch;
      let downloadResponse: Response;
      try {
        downloadResponse = await downloadFetch(image0, {
          signal: context?.signal,
        });
      } catch (error) {
        if (context?.signal?.aborted) {
          // The caller's abort keeps its own error and 504 wording.
          throw error;
        }
        throw new ProviderResultDeliveryError(
          `downloading the result image failed (${
            error instanceof Error ? error.message : String(error)
          })`,
        );
      }
      if (!downloadResponse.ok) {
        throw new ProviderResultDeliveryError(
          `downloading the result image failed with HTTP ${downloadResponse.status}`,
        );
      }
      try {
        image = await downloadResponse.blob();
      } catch (error) {
        if (context?.signal?.aborted) {
          throw error;
        }
        throw new ProviderResultDeliveryError(
          `reading the downloaded result image failed (${
            error instanceof Error ? error.message : String(error)
          })`,
        );
      }
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
        totalInputImages: String(totalInputImages),
        watermark: String(this.options.watermark ?? false),
      },
    };
  }
}

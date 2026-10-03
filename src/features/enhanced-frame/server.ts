/**
 * Enhanced first-frame request core (Prompt 7B1 / Phase 2 Day 8 fallback;
 * acceptance fix round 2026-09-23).
 *
 * Pure request handler behind the /api/enhanced-frame route: validates the
 * multipart request against the documented limits, selects exactly one image
 * adapter (D027, single-active; mock is the default), enforces the selected
 * provider's verified total input-image limit, runs generation under one
 * TOTAL budget (an AbortSignal deadline propagated into the adapter — it
 * cancels requests, response reads, backoff waits and result downloads, not
 * merely the local wait) and returns a structured result or a structured
 * error — provider failure is a retryable 502/504 and NEVER blocks the
 * client's raw export, which does not depend on this path at all.
 *
 * Pure module: Web-standard FormData/Blob only; no Next.js imports, no
 * process.env reads (the caller passes the provider setting), no filesystem,
 * no network of its own (adapters own their calls; the mock has none).
 */
import type {
  GeneratedImageArtifact,
  ImageGenerationInput,
} from "@/adapters/image-generation/types";
import {
  ProviderResultDeliveryError,
  isProviderOutcomeUnknown,
} from "@/adapters/image-generation/provider-http";
import { bytesToBase64 } from "@/adapters/image-generation/binary";

import {
  normalizeImageProvider,
  selectImageGenerationAdapter,
  ProviderAdapterNotImplementedError,
  UnsupportedImageProviderError,
  type ImageAdapterRegistry,
  type ImageProviderId,
} from "./adapter-selection";
import { PROVIDER_CREDENTIAL_ENV_VARS, providerCredentialPresent } from "./registry";

/**
 * Generic transport hygiene limits for this route (upload size/type/prompt
 * length). These are NOT provider claims: provider-verified input contracts —
 * such as Wan 2.7's total input-image limit — live in
 * PROVIDER_TOTAL_INPUT_IMAGE_LIMITS below and are enforced per selected
 * provider. Limits a provider has not verified (e.g. a total image count for
 * Ark, UNCONFIRMED in docs/PROVIDER_SPIKE.md) are deliberately not invented.
 */
export const ENHANCED_FRAME_LIMITS = {
  maxPromptLengthChars: 5_000,
  maxImageBytes: 20 * 1024 * 1024,
  maxCharacterReferences: 9,
  acceptedImageMimeTypes: ["image/png", "image/jpeg", "image/webp"] as const,
  /**
   * Outer generation budget. Live-verified 2026-09-22: pro-tier Seedream
   * generation legitimately exceeds 30s, so the budget must sit comfortably
   * above the per-attempt HTTP timeout (100s in provider-http.ts). The budget
   * is a hard deadline: it aborts the adapter's requests and downloads, not
   * merely the local wait (acceptance fix round 2026-09-23).
   */
  defaultTimeoutMs: 120_000,
} as const;

/**
 * Verified TOTAL input-image limits (composition + character references +
 * optional style reference) per provider. Wan 2.7: official API reference
 * (help.aliyun.com, re-verified 2026-09-23) allows 0–9 input images IN TOTAL.
 * Seedream: no official total documented (UNCONFIRMED) — no entry, no invented
 * limit. The mock has no provider contract — no entry.
 */
export const PROVIDER_TOTAL_INPUT_IMAGE_LIMITS: Partial<Record<ImageProviderId, number>> = {
  wanxiang: 9,
};

export type EnhancedFrameErrorCode =
  | "invalid_form_data"
  | "prompt_missing"
  | "prompt_too_long"
  | "composition_image_missing"
  | "image_too_large"
  | "unsupported_image_type"
  | "too_many_character_references"
  | "too_many_input_images"
  | "provider_adapter_not_implemented"
  | "provider_credentials_missing"
  | "unsupported_image_provider"
  | "image_generation_failed"
  | "image_generation_timeout";

export interface EnhancedFrameSuccess {
  imageBase64: string;
  imageMimeType: string;
  adapterId: string;
  adapterVersion: string;
  provider: ImageProviderId;
  metadata: Record<string, string>;
}

/** Literal status set keeps the result union discriminable on `status`. */
export type EnhancedFrameFailureStatus = 400 | 413 | 500 | 501 | 502 | 503 | 504;

export interface EnhancedFrameFailure {
  status: EnhancedFrameFailureStatus;
  body: { error: EnhancedFrameErrorCode; message: string };
}

export type EnhancedFrameResult =
  { status: 200; body: EnhancedFrameSuccess } | EnhancedFrameFailure;

export interface EnhancedFrameEnv {
  /** Value of the server-side IMAGE_PROVIDER setting (D027); unset means mock. */
  imageProvider?: string;
  /** Server-side production credentials (Prompt 7B2); presence gates 503 vs 501. */
  arkApiKey?: string;
  dashscopeApiKey?: string;
}

export interface EnhancedFrameOptions {
  /** Production-adapter registry (built by buildImageAdapterRegistry; empty = mock-only). */
  registry?: ImageAdapterRegistry;
  /** Generation timeout; the mock resolves instantly. */
  timeoutMs?: number;
}

class ImageGenerationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `image generation exceeded the ${timeoutMs}ms budget and was aborted locally; ` +
        "this cancels the local wait and connection only — it does not cancel any task the " +
        "provider may already have accepted and does not guarantee that no charge occurred",
    );
    this.name = "ImageGenerationTimeoutError";
  }
}

/**
 * Runs one generation under a TOTAL budget (acceptance fix round 2026-09-23).
 * Unlike the previous outer-only timeout, the deadline is armed as an
 * AbortController and handed to the adapter, so the generation POST, its
 * response read, any backoff wait and the result-image download are all
 * aborted when the budget expires — no further provider request can start.
 * The adapter promise is separately settled-safe: whichever side loses the
 * race has its rejection observed, so no unhandled rejection can escape.
 */
async function generateWithTotalBudget(
  adapter: {
    generate: (
      input: ImageGenerationInput,
      context?: { signal?: AbortSignal; deadlineAt?: number },
    ) => Promise<GeneratedImageArtifact>;
  },
  input: ImageGenerationInput,
  timeoutMs: number,
): Promise<GeneratedImageArtifact> {
  const controller = new AbortController();
  const deadlineAt = Date.now() + timeoutMs;
  const timeoutError = new ImageGenerationTimeoutError(timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = adapter.generate(input, { signal: controller.signal, deadlineAt });
  attempt.catch(() => {
    /* the race below owns the first settle; the loser is deliberately muted */
  });
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    return await Promise.race([attempt, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

function isFileValue(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" && value !== null;
}

function invalid(
  error: EnhancedFrameErrorCode,
  message: string,
  status: EnhancedFrameFailureStatus = 400,
): EnhancedFrameFailure {
  return { status, body: { error, message } };
}

function validateImage(
  value: FormDataEntryValue | null,
  field: string,
): { blob: Blob } | { error: EnhancedFrameResult } {
  if (!isFileValue(value)) {
    return {
      error: invalid("composition_image_missing", `field "${field}" must be a file upload`),
    };
  }
  if (value.size <= 0) {
    return { error: invalid("composition_image_missing", `field "${field}" is empty`) };
  }
  if (value.size > ENHANCED_FRAME_LIMITS.maxImageBytes) {
    return {
      error: invalid(
        "image_too_large",
        `field "${field}" is ${value.size} bytes; the limit is ${ENHANCED_FRAME_LIMITS.maxImageBytes}`,
        413,
      ),
    };
  }
  if (!(ENHANCED_FRAME_LIMITS.acceptedImageMimeTypes as readonly string[]).includes(value.type)) {
    return {
      error: invalid(
        "unsupported_image_type",
        `field "${field}" has type "${value.type}"; accepted: ${ENHANCED_FRAME_LIMITS.acceptedImageMimeTypes.join(", ")}`,
      ),
    };
  }
  return { blob: value };
}

function validateOptionalImage(
  value: FormDataEntryValue | null,
  field: string,
): { blob?: Blob } | { error: EnhancedFrameResult } {
  if (value === null || value === "") {
    return {};
  }
  const result = validateImage(value, field);
  return "error" in result ? result : { blob: result.blob };
}

/**
 * Handles one enhanced-frame request end to end. Never throws: every failure
 * (bad input, unimplemented/misconfigured provider, adapter error, timeout)
 * comes back as a structured { status, body } the route can return verbatim.
 */
export async function handleEnhancedFrameRequest(
  formData: FormData,
  env: EnhancedFrameEnv,
  options: EnhancedFrameOptions = {},
): Promise<EnhancedFrameResult> {
  const promptValue = formData.get("prompt");
  if (typeof promptValue !== "string" || promptValue.trim().length === 0) {
    return invalid("prompt_missing", 'field "prompt" must be a non-empty string');
  }
  if (promptValue.length > ENHANCED_FRAME_LIMITS.maxPromptLengthChars) {
    return invalid(
      "prompt_too_long",
      `prompt is ${promptValue.length} chars; the limit is ${ENHANCED_FRAME_LIMITS.maxPromptLengthChars}`,
    );
  }

  const composition = validateImage(formData.get("compositionImage"), "compositionImage");
  if ("error" in composition) {
    return composition.error;
  }
  const style = validateOptionalImage(formData.get("styleReference"), "styleReference");
  if ("error" in style) {
    return style.error;
  }

  const referenceBlobs: Blob[] = [];
  for (const entry of formData.getAll("characterReferences")) {
    if (entry === "") {
      continue;
    }
    const validated = validateOptionalImage(entry, "characterReferences");
    if ("error" in validated) {
      return validated.error;
    }
    if (validated.blob !== undefined) {
      referenceBlobs.push(validated.blob);
    }
  }
  if (referenceBlobs.length > ENHANCED_FRAME_LIMITS.maxCharacterReferences) {
    return invalid(
      "too_many_character_references",
      `${referenceBlobs.length} character references given; the limit is ${ENHANCED_FRAME_LIMITS.maxCharacterReferences}`,
    );
  }

  let provider: ImageProviderId;
  try {
    provider = normalizeImageProvider(env.imageProvider);
  } catch (error) {
    if (error instanceof UnsupportedImageProviderError) {
      return {
        status: 500,
        body: { error: "unsupported_image_provider", message: error.message },
      };
    }
    throw error;
  }
  if (provider !== "mock" && !providerCredentialPresent(provider, env)) {
    return {
      status: 503,
      body: {
        error: "provider_credentials_missing",
        message:
          `IMAGE_PROVIDER="${provider}" is selected but ${PROVIDER_CREDENTIAL_ENV_VARS[provider]} ` +
          "is not set on the server; set it in .env.local and restart, or switch IMAGE_PROVIDER=mock",
      },
    };
  }

  let selected;
  try {
    selected = selectImageGenerationAdapter(env.imageProvider, options.registry ?? {});
  } catch (error) {
    if (error instanceof ProviderAdapterNotImplementedError) {
      return {
        status: 501,
        body: { error: "provider_adapter_not_implemented", message: error.message },
      };
    }
    throw error;
  }

  const totalInputImages = 1 + referenceBlobs.length + (style.blob !== undefined ? 1 : 0);
  const providerTotalLimit = PROVIDER_TOTAL_INPUT_IMAGE_LIMITS[provider];
  if (providerTotalLimit !== undefined && totalInputImages > providerTotalLimit) {
    return invalid(
      "too_many_input_images",
      `provider "${provider}" accepts at most ${providerTotalLimit} input images in total; ` +
        `this request carries ${totalInputImages} (1 composition image + ${referenceBlobs.length} character references` +
        `${style.blob !== undefined ? " + 1 style reference" : ""}); remove references before generating`,
    );
  }

  const input: ImageGenerationInput = {
    compositionImage: composition.blob,
    characterReferences: referenceBlobs.length > 0 ? referenceBlobs : undefined,
    styleReference: style.blob,
    prompt: promptValue,
  };

  const timeoutMs = options.timeoutMs ?? ENHANCED_FRAME_LIMITS.defaultTimeoutMs;
  let artifact: GeneratedImageArtifact;
  try {
    artifact = await generateWithTotalBudget(selected.adapter, input, timeoutMs);
  } catch (error) {
    if (error instanceof ImageGenerationTimeoutError) {
      return { status: 504, body: { error: "image_generation_timeout", message: error.message } };
    }
    const detail = error instanceof Error ? error.message : String(error);
    // Delivered-result failure (acceptance R2-1): the provider accepted the
    // generation (2xx + contract) but its result could not be delivered — a
    // Wan URL-result download failure or an undecodable payload. Distinct
    // message, same charge warning.
    if (error instanceof ProviderResultDeliveryError) {
      return {
        status: 502,
        body: {
          error: "image_generation_failed",
          message:
            `provider "${selected.provider}" accepted the generation but delivering its result ` +
            `failed: ${detail}. The generation itself may already be billed; generating again ` +
            "may incur an additional charge.",
        },
      };
    }
    // Outcome-unknown (acceptance P1-2 + R2-1): a network failure, per-attempt
    // timeout, 5xx response, or an accepted response that failed JSON parsing
    // or the declared contract does not prove the provider did not run or
    // bill the generation, so the message must say so.
    if (isProviderOutcomeUnknown(error)) {
      return {
        status: 502,
        body: {
          error: "image_generation_failed",
          message:
            `provider "${selected.provider}" failed with an UNKNOWN OUTCOME: ${detail}. ` +
            "The provider may have accepted or completed this generation; generating again " +
            "may incur an additional charge.",
        },
      };
    }
    // Definite failure (bad input reached the adapter, refused generation URL,
    // 4xx, adapter bug): plain message, no charge warning.
    return {
      status: 502,
      body: {
        error: "image_generation_failed",
        message: `provider "${selected.provider}" failed: ${detail}`,
      },
    };
  }

  const imageBytes = new Uint8Array(await artifact.image.arrayBuffer());
  return {
    status: 200,
    body: {
      imageBase64: bytesToBase64(imageBytes),
      imageMimeType: artifact.image.type,
      adapterId: artifact.adapterId,
      adapterVersion: artifact.adapterVersion,
      provider: selected.provider,
      metadata: artifact.metadata,
    },
  };
}

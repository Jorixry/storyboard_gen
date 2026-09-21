/**
 * Enhanced first-frame request core (Prompt 7B1 / Phase 2 Day 8 fallback).
 *
 * Pure request handler behind the /api/enhanced-frame route: validates the
 * multipart request against the documented provider limits (see
 * docs/PROVIDER_SPIKE.md), selects exactly one image adapter (D027,
 * single-active; mock is the default), runs generation under a timeout and
 * returns a structured result or a structured error — provider failure is a
 * retryable 502/504 and NEVER blocks the client's raw export, which does not
 * depend on this path at all.
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
  selectImageGenerationAdapter,
  ProviderAdapterNotImplementedError,
  UnsupportedImageProviderError,
  type ImageAdapterRegistry,
  type ImageProviderId,
} from "./adapter-selection";

/**
 * Documented provider limits adopted as the shared request contract (strictest
 * documented values from docs/PROVIDER_SPIKE.md: Wan 2.7 takes <=9 reference
 * images and <=20MB per image; prompt <=5000 chars; Seedream accepts the same
 * raster types). Production adapters (7B2) may tighten, never loosen, these.
 */
export const ENHANCED_FRAME_LIMITS = {
  maxPromptLengthChars: 5_000,
  maxImageBytes: 20 * 1024 * 1024,
  maxCharacterReferences: 9,
  acceptedImageMimeTypes: ["image/png", "image/jpeg", "image/webp"] as const,
  defaultTimeoutMs: 30_000,
} as const;

export type EnhancedFrameErrorCode =
  | "invalid_form_data"
  | "prompt_missing"
  | "prompt_too_long"
  | "composition_image_missing"
  | "image_too_large"
  | "unsupported_image_type"
  | "too_many_character_references"
  | "provider_adapter_not_implemented"
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
export type EnhancedFrameFailureStatus = 400 | 413 | 500 | 501 | 502 | 504;

export interface EnhancedFrameFailure {
  status: EnhancedFrameFailureStatus;
  body: { error: EnhancedFrameErrorCode; message: string };
}

export type EnhancedFrameResult =
  { status: 200; body: EnhancedFrameSuccess } | EnhancedFrameFailure;

export interface EnhancedFrameEnv {
  /** Value of the server-side IMAGE_PROVIDER setting (D027); unset means mock. */
  imageProvider?: string;
}

export interface EnhancedFrameOptions {
  /** Production-adapter registry (empty in 7B1; filled by Prompt 7B2). */
  registry?: ImageAdapterRegistry;
  /** Generation timeout; the mock resolves instantly. */
  timeoutMs?: number;
}

class ImageGenerationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`image generation exceeded the ${timeoutMs}ms budget and was aborted`);
    this.name = "ImageGenerationTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ImageGenerationTimeoutError(timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Chunked base64 (8-bit-safe in every runtime; no Buffer dependency). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8_192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
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
    if (error instanceof UnsupportedImageProviderError) {
      return {
        status: 500,
        body: { error: "unsupported_image_provider", message: error.message },
      };
    }
    throw error;
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
    artifact = await withTimeout(selected.adapter.generate(input), timeoutMs);
  } catch (error) {
    if (error instanceof ImageGenerationTimeoutError) {
      return { status: 504, body: { error: "image_generation_timeout", message: error.message } };
    }
    return {
      status: 502,
      body: {
        error: "image_generation_failed",
        message: `provider "${selected.provider}" failed: ${error instanceof Error ? error.message : String(error)}`,
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

import { describe, expect, it } from "vitest";

import type { ImageGenerationAdapter } from "../../src/adapters/image-generation/types";
import {
  IMAGE_PROVIDER_IDS,
  selectImageGenerationAdapter,
  UnsupportedImageProviderError,
} from "../../src/features/enhanced-frame/adapter-selection";
import {
  ENHANCED_FRAME_LIMITS,
  handleEnhancedFrameRequest,
  type EnhancedFrameErrorCode,
  type EnhancedFrameResult,
  type EnhancedFrameSuccess,
} from "../../src/features/enhanced-frame/server";

/**
 * Enhanced first-frame contract tests (Prompt 7B1 / Phase 2 Day 8 fallback).
 * All requests run against the pure handler core with the deterministic mock
 * or injected fake adapters — zero network, zero credentials, zero cost.
 */

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngBlob(bytes: Uint8Array = PNG_BYTES, type = "image/png"): Blob {
  return new Blob([bytes as BlobPart], { type });
}

function baseFormData(): FormData {
  const formData = new FormData();
  formData.append("compositionImage", pngBlob(), "composition-raw.png");
  formData.append("prompt", "generic-video-prompt: model-agnostic engineering reference");
  return formData;
}

/** Narrows a result to the success branch (fails the test otherwise). */
function expectSuccess(result: EnhancedFrameResult): EnhancedFrameSuccess {
  if (result.status !== 200) {
    throw new Error(`expected a 200 success, got ${result.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

/** Asserts the error branch and returns it for message-level checks. */
function expectFailure(
  result: EnhancedFrameResult,
  status: number,
  code: EnhancedFrameErrorCode,
): { error: EnhancedFrameErrorCode; message: string } {
  if (result.status === 200) {
    throw new Error(`expected a ${status} ${code} failure, got a success`);
  }
  expect(result.status).toBe(status);
  expect(result.body.error).toBe(code);
  return result.body;
}

describe("selectImageGenerationAdapter (D027 single-active)", () => {
  it("treats unset, empty and 'mock' as the deterministic mock adapter", () => {
    for (const setting of [undefined, "", "  ", "mock"]) {
      const { adapter, provider } = selectImageGenerationAdapter(setting, {});
      expect(provider).toBe("mock");
      expect(adapter.id).toBe("mock-image-generation");
    }
  });

  it("answers the documented provider ids", () => {
    expect([...IMAGE_PROVIDER_IDS]).toEqual(["mock", "seedream", "wanxiang"]);
  });

  it("rejects any other value as a server misconfiguration", () => {
    expect(() => selectImageGenerationAdapter("gemini", {})).toThrow(UnsupportedImageProviderError);
    expect(() => selectImageGenerationAdapter("Seedream", {})).toThrow(
      UnsupportedImageProviderError,
    );
    // Surrounding whitespace in an env value is tolerated, not a misconfiguration.
    expect(() => selectImageGenerationAdapter(" seedream ", {})).not.toThrow(
      UnsupportedImageProviderError,
    );
  });

  it("returns a registered production adapter for its provider", () => {
    const fake: ImageGenerationAdapter = {
      id: "seedream-test",
      version: "0.0.0",
      generate: async () => {
        throw new Error("not called");
      },
    };
    const { adapter, provider } = selectImageGenerationAdapter("seedream", { seedream: fake });
    expect(provider).toBe("seedream");
    expect(adapter).toBe(fake);
  });
});

describe("handleEnhancedFrameRequest happy path (mock)", () => {
  it("returns 200 with the mock image as base64 and traceable metadata", async () => {
    const body = expectSuccess(await handleEnhancedFrameRequest(baseFormData(), {}));
    expect(body.adapterId).toBe("mock-image-generation");
    expect(body.adapterVersion).toBe("1.0.0");
    expect(body.provider).toBe("mock");
    expect(body.imageMimeType).toBe("image/svg+xml");
    const svg = atob(body.imageBase64);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(typeof body.metadata.signature).toBe("string");
    expect(body.metadata.hasStyleReference).toBe("false");
  });

  it("passes optional character/style references into the mock input signature", async () => {
    const formData = baseFormData();
    formData.append("characterReferences", pngBlob(), "ref-a.png");
    formData.append("characterReferences", pngBlob(new Uint8Array([1, 2, 3])), "ref-b.png");
    formData.append("styleReference", pngBlob(new Uint8Array([9, 9])), "style.png");
    const body = expectSuccess(await handleEnhancedFrameRequest(formData, {}));
    expect(body.metadata.referenceCount).toBe("2");
    expect(body.metadata.hasStyleReference).toBe("true");
  });

  it("is deterministic: identical requests produce identical responses", async () => {
    const first = await handleEnhancedFrameRequest(baseFormData(), {});
    const second = await handleEnhancedFrameRequest(baseFormData(), {});
    expect(second).toEqual(first);
  });
});

describe("handleEnhancedFrameRequest input validation", () => {
  it("rejects a missing prompt", async () => {
    const formData = baseFormData();
    formData.delete("prompt");
    expectFailure(await handleEnhancedFrameRequest(formData, {}), 400, "prompt_missing");
  });

  it("rejects an over-long prompt", async () => {
    const formData = baseFormData();
    formData.set("prompt", "x".repeat(ENHANCED_FRAME_LIMITS.maxPromptLengthChars + 1));
    expectFailure(await handleEnhancedFrameRequest(formData, {}), 400, "prompt_too_long");
  });

  it("rejects a missing composition image", async () => {
    const formData = baseFormData();
    formData.delete("compositionImage");
    expectFailure(await handleEnhancedFrameRequest(formData, {}), 400, "composition_image_missing");
  });

  it("rejects an unsupported image mime type", async () => {
    const formData = baseFormData();
    formData.delete("compositionImage");
    formData.append("compositionImage", pngBlob(PNG_BYTES, "image/tiff"), "composition.tiff");
    expectFailure(await handleEnhancedFrameRequest(formData, {}), 400, "unsupported_image_type");
  });

  it("rejects an image above the byte limit with 413", async () => {
    const oversized = new Uint8Array(ENHANCED_FRAME_LIMITS.maxImageBytes + 1);
    const formData = baseFormData();
    formData.delete("compositionImage");
    formData.append("compositionImage", pngBlob(oversized), "huge.png");
    expectFailure(await handleEnhancedFrameRequest(formData, {}), 413, "image_too_large");
  });

  it("rejects more character references than the documented provider limit", async () => {
    const formData = baseFormData();
    for (let index = 0; index <= ENHANCED_FRAME_LIMITS.maxCharacterReferences; index += 1) {
      formData.append("characterReferences", pngBlob(), `ref-${index}.png`);
    }
    expectFailure(
      await handleEnhancedFrameRequest(formData, {}),
      400,
      "too_many_character_references",
    );
  });
});

describe("handleEnhancedFrameRequest provider selection and failures", () => {
  it("IMAGE_PROVIDER=seedream without ARK_API_KEY answers 503 credentials-missing", async () => {
    const failure = expectFailure(
      await handleEnhancedFrameRequest(baseFormData(), { imageProvider: "seedream" }),
      503,
      "provider_credentials_missing",
    );
    expect(failure.message).toContain("ARK_API_KEY");
    expect(failure.message).toContain("IMAGE_PROVIDER");
  });

  it("IMAGE_PROVIDER=wanxiang without DASHSCOPE_API_KEY answers the same 503 contract", async () => {
    const failure = expectFailure(
      await handleEnhancedFrameRequest(baseFormData(), { imageProvider: "wanxiang" }),
      503,
      "provider_credentials_missing",
    );
    expect(failure.message).toContain("DASHSCOPE_API_KEY");
  });

  it("with the credential present but no registered adapter, answers 501 (defensive)", async () => {
    expectFailure(
      await handleEnhancedFrameRequest(baseFormData(), {
        imageProvider: "seedream",
        arkApiKey: "present-but-registry-empty",
      }),
      501,
      "provider_adapter_not_implemented",
    );
  });

  it("an unknown IMAGE_PROVIDER value answers 500 unsupported_image_provider", async () => {
    expectFailure(
      await handleEnhancedFrameRequest(baseFormData(), { imageProvider: "someone-else" }),
      500,
      "unsupported_image_provider",
    );
  });

  it("maps an adapter error to a retryable 502 image_generation_failed", async () => {
    const failing: ImageGenerationAdapter = {
      id: "failing-test",
      version: "0.0.0",
      generate: async () => {
        throw new Error("provider exploded");
      },
    };
    const failure = expectFailure(
      await handleEnhancedFrameRequest(
        baseFormData(),
        { imageProvider: "seedream", arkApiKey: "k" },
        { registry: { seedream: failing } },
      ),
      502,
      "image_generation_failed",
    );
    expect(failure.message).toContain("seedream");
    expect(failure.message).toContain("provider exploded");
  });

  it("maps a hanging adapter to 504 image_generation_timeout", async () => {
    const hanging: ImageGenerationAdapter = {
      id: "hanging-test",
      version: "0.0.0",
      generate: () => new Promise(() => {}),
    };
    expectFailure(
      await handleEnhancedFrameRequest(
        baseFormData(),
        { imageProvider: "seedream", arkApiKey: "k" },
        { registry: { seedream: hanging }, timeoutMs: 20 },
      ),
      504,
      "image_generation_timeout",
    );
  });

  it("a registered production adapter flows through with its identity and metadata", async () => {
    const produced: ImageGenerationAdapter = {
      id: "seedream-test",
      version: "9.9.9",
      generate: async () => ({
        adapterId: "seedream-test",
        adapterVersion: "9.9.9",
        image: pngBlob(new Uint8Array([1, 2, 3, 4])),
        metadata: { model: "doubao-seedream-4-0-test" },
      }),
    };
    const body = expectSuccess(
      await handleEnhancedFrameRequest(
        baseFormData(),
        { imageProvider: "seedream", arkApiKey: "k" },
        { registry: { seedream: produced } },
      ),
    );
    expect(body.adapterId).toBe("seedream-test");
    expect(body.adapterVersion).toBe("9.9.9");
    expect(body.provider).toBe("seedream");
    expect(body.metadata.model).toBe("doubao-seedream-4-0-test");
  });
});

import { describe, expect, it, vi } from "vitest";

import type { ImageGenerationAdapter } from "../../src/adapters/image-generation/types";
import {
  ProviderHttpError,
  ProviderOutcomeUnknownError,
} from "../../src/adapters/image-generation/provider-http";
import { SeedreamImageGenerationAdapter } from "../../src/adapters/image-generation/seedream";
import { WanxiangImageGenerationAdapter } from "../../src/adapters/image-generation/wanxiang";
import {
  IMAGE_PROVIDER_IDS,
  selectImageGenerationAdapter,
  UnsupportedImageProviderError,
} from "../../src/features/enhanced-frame/adapter-selection";
import {
  ENHANCED_FRAME_LIMITS,
  PROVIDER_TOTAL_INPUT_IMAGE_LIMITS,
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
    // A definitive failure must NOT carry the outcome-unknown warning.
    expect(failure.message).not.toContain("UNKNOWN OUTCOME");
  });

  it("marks a network-type failure as outcome-unknown and warns about extra charges", async () => {
    const failing: ImageGenerationAdapter = {
      id: "failing-test",
      version: "0.0.0",
      generate: async () => {
        throw new ProviderOutcomeUnknownError(
          "https://provider.example.test/generate",
          "network",
          new TypeError("connection lost after the provider accepted the request"),
        );
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
    expect(failure.message).toContain("UNKNOWN OUTCOME");
    expect(failure.message).toContain("additional charge");
  });

  it("marks a 5xx provider response as outcome-unknown too", async () => {
    const failing: ImageGenerationAdapter = {
      id: "failing-test",
      version: "0.0.0",
      generate: async () => {
        throw new ProviderHttpError(503, "upstream busy", "https://provider.example.test/g");
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
    expect(failure.message).toContain("UNKNOWN OUTCOME");
    // A definitive 4xx stays a plain failure.
    const definitive: ImageGenerationAdapter = {
      id: "failing-test",
      version: "0.0.0",
      generate: async () => {
        throw new ProviderHttpError(400, "invalid parameter", "https://provider.example.test/g");
      },
    };
    const plain = expectFailure(
      await handleEnhancedFrameRequest(
        baseFormData(),
        { imageProvider: "seedream", arkApiKey: "k" },
        { registry: { seedream: definitive } },
      ),
      502,
      "image_generation_failed",
    );
    expect(plain.message).not.toContain("UNKNOWN OUTCOME");
  });

  it("maps a hanging adapter to 504 image_generation_timeout", async () => {
    const hanging: ImageGenerationAdapter = {
      id: "hanging-test",
      version: "0.0.0",
      generate: () => new Promise(() => {}),
    };
    const failure = expectFailure(
      await handleEnhancedFrameRequest(
        baseFormData(),
        { imageProvider: "seedream", arkApiKey: "k" },
        { registry: { seedream: hanging }, timeoutMs: 20 },
      ),
      504,
      "image_generation_timeout",
    );
    // Honest wording (acceptance P1-3): the local cancellation does NOT claim
    // to revoke the provider task or guarantee no charge.
    expect(failure.message).toContain("aborted locally");
    expect(failure.message).toContain("does not cancel any task");
    expect(failure.message).toContain("does not guarantee that no charge occurred");
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

describe("handleEnhancedFrameRequest submitted-failure classification (R2-1)", () => {
  /**
   * A fetch that behaves like the real one under an abort: hangs until its
   * AbortSignal fires, then rejects with a bare AbortError DOMException.
   */
  function hangingUntilAbortFetch() {
    return vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted.", "AbortError")),
            { once: true },
          );
        }),
    );
  }

  it("a per-attempt timeout is outcome-unknown (NOT a plain 502) and POSTs once", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = hangingUntilAbortFetch();
      const adapter = new SeedreamImageGenerationAdapter({
        apiKey: "fixture",
        timeoutMs: 10, // per-attempt fires well before the 100ms total budget
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const pending = handleEnhancedFrameRequest(
        baseFormData(),
        { imageProvider: "seedream", arkApiKey: "k" },
        { registry: { seedream: adapter }, timeoutMs: 100 },
      );
      await vi.advanceTimersByTimeAsync(11);
      const failure = expectFailure(await pending, 502, "image_generation_failed");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      // Honest wording, matching the total-timeout 504: a local abort does
      // not revoke a provider task, and retrying may bill again.
      expect(failure.message).toContain("UNKNOWN OUTCOME");
      expect(failure.message).toContain("aborted locally");
      expect(failure.message).toContain("does not cancel any task");
      expect(failure.message).toContain("does not guarantee that no charge occurred");
      expect(failure.message).toContain("additional charge");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an accepted 200 with an unparseable JSON body is outcome-unknown and POSTs once", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("this is not json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const adapter = new SeedreamImageGenerationAdapter({
      apiKey: "fixture",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const failure = expectFailure(
      await handleEnhancedFrameRequest(
        baseFormData(),
        { imageProvider: "seedream", arkApiKey: "k" },
        { registry: { seedream: adapter } },
      ),
      502,
      "image_generation_failed",
    );
    expect(failure.message).toContain("UNKNOWN OUTCOME");
    expect(failure.message).toContain("not parseable JSON");
    expect(failure.message).toContain("additional charge");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("an accepted 200 failing the response contract is outcome-unknown and POSTs once", async () => {
    // {data: []} validates against transport but not the Ark contract.
    const fetchImpl = vi.fn(async () => Response.json({ data: [] }));
    const adapter = new SeedreamImageGenerationAdapter({
      apiKey: "fixture",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const failure = expectFailure(
      await handleEnhancedFrameRequest(
        baseFormData(),
        { imageProvider: "seedream", arkApiKey: "k" },
        { registry: { seedream: adapter } },
      ),
      502,
      "image_generation_failed",
    );
    expect(failure.message).toContain("UNKNOWN OUTCOME");
    expect(failure.message).toContain("failed its contract");
    expect(failure.message).toContain("additional charge");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a Wan result-download failure after a successful generation is a delivered-result failure", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (calls.length === 1) {
        return Response.json({
          output: {
            choices: [
              { message: { content: [{ image: "https://result.example.test/frame.png" }] } },
            ],
          },
          request_id: "req-1",
        });
      }
      return new Response("gone", { status: 404 });
    }) as typeof fetch;
    const adapter = new WanxiangImageGenerationAdapter({ apiKey: "fixture", fetchImpl });
    const failure = expectFailure(
      await handleEnhancedFrameRequest(
        baseFormData(),
        { imageProvider: "wanxiang", dashscopeApiKey: "k" },
        { registry: { wanxiang: adapter } },
      ),
      502,
      "image_generation_failed",
    );
    // The generation POST itself ran exactly once; only its delivery failed.
    expect(calls).toHaveLength(2);
    expect(calls[0]!.init.method).toBe("POST");
    expect(failure.message).toContain("delivering its result failed");
    expect(failure.message).toContain("HTTP 404");
    expect(failure.message).toContain("additional charge");
    // A delivery failure is accurately named, not lumped into UNKNOWN OUTCOME.
    expect(failure.message).not.toContain("UNKNOWN OUTCOME");
  });

  it("a pre-call refused generation URL stays a definitive failure without the charge warning", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const adapter = new SeedreamImageGenerationAdapter({
      apiKey: "fixture",
      baseUrl: "http://localhost:3000",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const failure = expectFailure(
      await handleEnhancedFrameRequest(
        baseFormData(),
        { imageProvider: "seedream", arkApiKey: "k" },
        { registry: { seedream: adapter } },
      ),
      502,
      "image_generation_failed",
    );
    // Refused before submission: nothing was sent, so no charge warning.
    expect(fetchImpl).toHaveBeenCalledTimes(0);
    expect(failure.message).toContain("is not allowed");
    expect(failure.message).not.toContain("UNKNOWN OUTCOME");
    expect(failure.message).not.toContain("additional charge");
  });
});

describe("handleEnhancedFrameRequest total generation budget (P1-3)", () => {
  /** Fake-arn Seedream adapter wrapper so the real adapter code runs under fake timers. */
  function seedreamWithFetch(fetchImpl: typeof fetch): SeedreamImageGenerationAdapter {
    return new SeedreamImageGenerationAdapter({ apiKey: "fixture", fetchImpl });
  }

  it("stops 429-backoff resubmission once the total budget expires (fake timers)", async () => {
    vi.useFakeTimers();
    try {
      const postTimes: number[] = [];
      const adapter = seedreamWithFetch((async () => {
        postTimes.push(Date.now());
        return new Response("rate limited", { status: 429 });
      }) as typeof fetch);
      const pending = handleEnhancedFrameRequest(
        baseFormData(),
        { imageProvider: "seedream", arkApiKey: "k" },
        { registry: { seedream: adapter }, timeoutMs: 20 },
      );
      await vi.advanceTimersByTimeAsync(25);
      const result = await pending;
      expectFailure(result, 504, "image_generation_timeout");
      expect(postTimes).toHaveLength(1);
      // Advancing FAR beyond the budget must not submit another paid POST.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(postTimes).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts the in-flight provider fetch when the budget expires", async () => {
    vi.useFakeTimers();
    try {
      const observedSignals: AbortSignal[] = [];
      const adapter = seedreamWithFetch((async (_url: RequestInfo | URL, init?: RequestInit) => {
        observedSignals.push((init as { signal?: AbortSignal } | undefined)?.signal as AbortSignal);
        // Hangs like a slow generation; only the abort can end it.
        return await new Promise<Response>(() => {});
      }) as typeof fetch);
      const pending = handleEnhancedFrameRequest(
        baseFormData(),
        { imageProvider: "seedream", arkApiKey: "k" },
        { registry: { seedream: adapter }, timeoutMs: 20 },
      );
      await vi.advanceTimersByTimeAsync(25);
      expectFailure(await pending, 504, "image_generation_timeout");
      expect(observedSignals).toHaveLength(1);
      expect(observedSignals[0]!.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans its timer up after a successful generation", async () => {
    vi.useFakeTimers();
    try {
      expect(vi.getTimerCount()).toBe(0);
      const result = await handleEnhancedFrameRequest(
        baseFormData(),
        {},
        { timeoutMs: 5_000 }, // mock resolves instantly under fake timers
      );
      expectSuccess(result);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("handleEnhancedFrameRequest provider total input-image limit (P2-2)", () => {
  function wanxiangRegistry(generate: ImageGenerationAdapter["generate"]): {
    registry: { wanxiang: ImageGenerationAdapter };
    generate: ReturnType<typeof vi.fn>;
  } {
    const spy = vi.fn(generate);
    return {
      registry: { wanxiang: { id: "wanxiang-fake", version: "0.0.0", generate: spy } },
      generate: spy,
    };
  }

  function references(count: number, style: boolean): FormData {
    const formData = baseFormData();
    for (let index = 0; index < count; index += 1) {
      formData.append("characterReferences", pngBlob(), `ref-${index}.png`);
    }
    if (style) {
      formData.append("styleReference", pngBlob(), "style.png");
    }
    return formData;
  }

  it("documents the verified provider totals: wanxiang only", () => {
    expect(PROVIDER_TOTAL_INPUT_IMAGE_LIMITS).toEqual({ wanxiang: 9 });
  });

  it("accepts exactly 9 total input images WITH a style reference (1+7+1)", async () => {
    const { registry, generate } = wanxiangRegistry(async () => ({
      adapterId: "wanxiang-fake",
      adapterVersion: "0.0.0",
      image: pngBlob(new Uint8Array([1])),
      metadata: {},
    }));
    const body = expectSuccess(
      await handleEnhancedFrameRequest(
        references(7, true),
        { imageProvider: "wanxiang", dashscopeApiKey: "k" },
        { registry },
      ),
    );
    expect(body.adapterId).toBe("wanxiang-fake");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("accepts exactly 9 total input images WITHOUT a style reference (1+8+0)", async () => {
    const { registry, generate } = wanxiangRegistry(async () => ({
      adapterId: "wanxiang-fake",
      adapterVersion: "0.0.0",
      image: pngBlob(new Uint8Array([1])),
      metadata: {},
    }));
    expectSuccess(
      await handleEnhancedFrameRequest(
        references(8, false),
        { imageProvider: "wanxiang", dashscopeApiKey: "k" },
        { registry },
      ),
    );
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("rejects 10 total input images BEFORE the adapter is called (1+8+1)", async () => {
    const { registry, generate } = wanxiangRegistry(async () => ({
      adapterId: "wanxiang-fake",
      adapterVersion: "0.0.0",
      image: pngBlob(new Uint8Array([1])),
      metadata: {},
    }));
    const failure = expectFailure(
      await handleEnhancedFrameRequest(
        references(8, true),
        { imageProvider: "wanxiang", dashscopeApiKey: "k" },
        { registry },
      ),
      400,
      "too_many_input_images",
    );
    expect(failure.message).toContain("10");
    expect(failure.message).toContain("wanxiang");
    expect(failure.message).toContain("9");
    expect(generate).toHaveBeenCalledTimes(0);
  });

  it("rejects 11 total input images (1+9+1) — the acceptance probe scenario", async () => {
    const { registry, generate } = wanxiangRegistry(async () => ({
      adapterId: "wanxiang-fake",
      adapterVersion: "0.0.0",
      image: pngBlob(new Uint8Array([1])),
      metadata: {},
    }));
    const failure = expectFailure(
      await handleEnhancedFrameRequest(
        references(9, true),
        { imageProvider: "wanxiang", dashscopeApiKey: "k" },
        { registry },
      ),
      400,
      "too_many_input_images",
    );
    expect(failure.message).toContain("11");
    expect(failure.message).toContain("1 style reference");
    expect(generate).toHaveBeenCalledTimes(0);
  });

  it("rejects 10 totals without a style reference too (1+9+0)", async () => {
    const { registry, generate } = wanxiangRegistry(async () => ({
      adapterId: "wanxiang-fake",
      adapterVersion: "0.0.0",
      image: pngBlob(new Uint8Array([1])),
      metadata: {},
    }));
    expectFailure(
      await handleEnhancedFrameRequest(
        references(9, false),
        { imageProvider: "wanxiang", dashscopeApiKey: "k" },
        { registry },
      ),
      400,
      "too_many_input_images",
    );
    expect(generate).toHaveBeenCalledTimes(0);
  });

  it("invents no total for providers without a verified limit (seedream, mock)", async () => {
    const seedreamRegistry = {
      seedream: {
        id: "seedream-fake",
        version: "0.0.0",
        generate: vi.fn(async () => ({
          adapterId: "seedream-fake",
          adapterVersion: "0.0.0",
          image: pngBlob(new Uint8Array([1])),
          metadata: {},
        })),
      } satisfies ImageGenerationAdapter,
    };
    // 11 total images are transport-hygienic (<=9 refs, all files valid) and
    // Seedream documents no total — the request must reach the adapter.
    expectSuccess(
      await handleEnhancedFrameRequest(
        references(9, true),
        { imageProvider: "seedream", arkApiKey: "k" },
        { registry: seedreamRegistry },
      ),
    );
    expect(seedreamRegistry.seedream.generate).toHaveBeenCalledTimes(1);
    // The mock path likewise has no provider total to enforce.
    expectSuccess(await handleEnhancedFrameRequest(references(9, true), {}));
  });
});

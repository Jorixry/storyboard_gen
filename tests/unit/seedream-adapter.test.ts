import { describe, expect, it } from "vitest";

import {
  SEEDREAM_DEFAULT_BASE_URL,
  SEEDREAM_DEFAULT_MODEL,
  SeedreamImageGenerationAdapter,
} from "../../src/adapters/image-generation/seedream";
import { bytesToBase64 } from "../../src/adapters/image-generation/binary";
import {
  ProviderHttpError,
  ProviderResponseContractError,
} from "../../src/adapters/image-generation/provider-http";
import type { ImageGenerationInput } from "../../src/adapters/image-generation/types";

/**
 * Seedream (Volcengine Ark) adapter contract tests — Prompt 7B2. The fetch
 * implementation is fully faked: zero network, zero credentials, zero cost.
 * These tests pin THIS ADAPTER'S request/response mapping; provider-side
 * verification on real infrastructure is deliberately deferred.
 */

interface RecordedCall {
  url: string;
  init: RequestInit;
}

/**
 * Each entry is a FACTORY: every attempt must get a fresh Response, because a
 * response body can be consumed only once and retries re-read the body.
 */
function fakeFetch(responseFactories: Array<() => Response | Error>) {
  const calls: RecordedCall[] = [];
  let attempt = 0;
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responseFactories[Math.min(attempt, responseFactories.length - 1)]!();
    attempt += 1;
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }) as typeof fetch;
  return { impl, calls, attempts: () => attempt };
}

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const GENERATED_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function baseInput(): ImageGenerationInput {
  return {
    compositionImage: new Blob([new Uint8Array([9, 9, 9])] as BlobPart[], { type: "image/png" }),
    characterReferences: [
      new Blob([new Uint8Array([1])] as BlobPart[], { type: "image/png" }),
      new Blob([new Uint8Array([2])] as BlobPart[], { type: "image/jpeg" }),
    ],
    styleReference: new Blob([new Uint8Array([3])] as BlobPart[], { type: "image/webp" }),
    prompt: "generic-video-prompt: model-agnostic engineering reference",
  };
}

function adapterWith(impl: typeof fetch, sleep: (ms: number) => Promise<void> = async () => {}) {
  return new SeedreamImageGenerationAdapter({
    apiKey: "test-ark-key",
    fetchImpl: impl,
    sleep,
  });
}

describe("SeedreamImageGenerationAdapter request contract", () => {
  it("POSTs the documented Ark shape: bearer auth, model, data-URL images in order", async () => {
    const { impl, calls } = fakeFetch([
      () => okResponse({ data: [{ b64_json: bytesToBase64(GENERATED_PNG) }] }),
    ]);
    const artifact = await adapterWith(impl).generate(baseInput());

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(`${SEEDREAM_DEFAULT_BASE_URL}/images/generations`);
    expect(call.init.method).toBe("POST");
    expect(new Headers(call.init.headers).get("Authorization")).toBe("Bearer test-ark-key");
    expect(new Headers(call.init.headers).get("Content-Type")).toBe("application/json");

    const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
    expect(body.model).toBe(SEEDREAM_DEFAULT_MODEL);
    expect(body.prompt).toBe("generic-video-prompt: model-agnostic engineering reference");
    expect(body.response_format).toBe("b64_json");
    expect(body.watermark).toBe(false);
    // Composition FIRST, then character references, then the style reference.
    const images = body.image as string[];
    expect(images).toHaveLength(4);
    expect(images[0]).toMatch(/^data:image\/png;base64,/);
    expect(images[1]).toMatch(/^data:image\/png;base64,/);
    expect(images[2]).toMatch(/^data:image\/jpeg;base64,/);
    expect(images[3]).toMatch(/^data:image\/webp;base64,/);

    expect(artifact.adapterId).toBe("seedream");
    expect(artifact.adapterVersion).toBe("1.0.0");
    expect(artifact.image.type).toBe("image/png");
    expect([...new Uint8Array(await artifact.image.arrayBuffer())]).toEqual([...GENERATED_PNG]);
    expect(artifact.metadata.provider).toBe("seedream");
    expect(artifact.metadata.model).toBe(SEEDREAM_DEFAULT_MODEL);
    expect(artifact.metadata.referenceCount).toBe("2");
    expect(artifact.metadata.hasStyleReference).toBe("true");
  });

  it("respects constructor overrides for endpoint, model and size", async () => {
    const { impl, calls } = fakeFetch([
      () => okResponse({ data: [{ b64_json: bytesToBase64(GENERATED_PNG) }] }),
    ]);
    const adapter = new SeedreamImageGenerationAdapter({
      apiKey: "k",
      baseUrl: "https://ark.example.test/api/v3",
      model: "doubao-seedream-4-5-test",
      size: "2K",
      fetchImpl: impl,
    });
    await adapter.generate({
      compositionImage: new Blob([new Uint8Array([1])] as BlobPart[], { type: "image/png" }),
      prompt: "p",
    });
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(calls[0]!.url).toBe("https://ark.example.test/api/v3/images/generations");
    expect(body.model).toBe("doubao-seedream-4-5-test");
    expect(body.size).toBe("2K");
  });

  it("refuses an empty API key at construction time", () => {
    expect(() => new SeedreamImageGenerationAdapter({ apiKey: "  " })).toThrow(/Ark API key/);
  });
});

describe("SeedreamImageGenerationAdapter failure and retry contract", () => {
  it("retries a 429 with backoff, then succeeds", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => {
      delays.push(ms);
    };
    const { impl, attempts } = fakeFetch([
      () => new Response("rate limited", { status: 429 }),
      () => okResponse({ data: [{ b64_json: bytesToBase64(GENERATED_PNG) }] }),
    ]);
    const artifact = await adapterWith(impl, sleep).generate(baseInput());
    expect(attempts()).toBe(2);
    expect(delays).toEqual([500]);
    expect(artifact.metadata.provider).toBe("seedream");
  });

  it("gives up after the retry budget on repeated 5xx", async () => {
    const { impl, attempts } = fakeFetch([() => new Response("boom", { status: 502 })]);
    await expect(adapterWith(impl, async () => {}).generate(baseInput())).rejects.toThrow(
      ProviderHttpError,
    );
    expect(attempts()).toBe(3);
  });

  it("does NOT retry a definitive 4xx", async () => {
    const { impl, attempts } = fakeFetch([
      () =>
        new Response(JSON.stringify({ error: { code: "InvalidParameter", message: "bad" } }), {
          status: 400,
        }),
    ]);
    await expect(adapterWith(impl).generate(baseInput())).rejects.toThrow(ProviderHttpError);
    expect(attempts()).toBe(1);
  });

  it("rejects a response that fails the Zod contract", async () => {
    const { impl } = fakeFetch([() => okResponse({ data: [] })]);
    await expect(adapterWith(impl).generate(baseInput())).rejects.toThrow(
      ProviderResponseContractError,
    );
  });

  it("is deterministic for identical input and identical provider response", async () => {
    const input = baseInput();
    const make = async () => {
      const { impl } = fakeFetch([
        () => okResponse({ data: [{ b64_json: bytesToBase64(GENERATED_PNG) }] }),
      ]);
      return adapterWith(impl).generate(input);
    };
    const first = await make();
    const second = await make();
    expect(second).toEqual(first);
  });
});

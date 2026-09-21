import { describe, expect, it } from "vitest";

import {
  WANXIANG_DEFAULT_BASE_URL,
  WANXIANG_DEFAULT_MODEL,
  WanxiangImageGenerationAdapter,
} from "../../src/adapters/image-generation/wanxiang";
import { bytesToBase64 } from "../../src/adapters/image-generation/binary";
import type { ImageGenerationInput } from "../../src/adapters/image-generation/types";

/**
 * Wan 2.7 (Alibaba DashScope) adapter contract tests — Prompt 7B2. Fully faked
 * fetch: zero network, zero credentials, zero cost.
 */

interface RecordedCall {
  url: string;
  init: RequestInit;
}

/** Each entry is a FACTORY so every fetch gets a fresh, unread Response body. */
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
  return { impl, calls };
}

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const RESULT_BYTES = new Uint8Array([1, 2, 3, 250]);

function baseInput(): ImageGenerationInput {
  return {
    compositionImage: new Blob([new Uint8Array([9])] as BlobPart[], { type: "image/png" }),
    characterReferences: [new Blob([new Uint8Array([1])] as BlobPart[], { type: "image/png" })],
    styleReference: new Blob([new Uint8Array([2])] as BlobPart[], { type: "image/webp" }),
    prompt: "generic prompt",
  };
}

function adapterWith(impl: typeof fetch) {
  return new WanxiangImageGenerationAdapter({ apiKey: "test-dashscope-key", fetchImpl: impl });
}

function syncBody(image: { image: string }) {
  return okResponse({
    output: { choices: [{ message: { content: [image] } }] },
    request_id: "req-1",
  });
}

describe("WanxiangImageGenerationAdapter request contract", () => {
  it("POSTs the documented sync multimodal shape with the composition image LAST", async () => {
    const { impl, calls } = fakeFetch([
      () => syncBody({ image: `data:image/png;base64,${bytesToBase64(RESULT_BYTES)}` }),
    ]);
    const artifact = await adapterWith(impl).generate(baseInput());

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(
      `${WANXIANG_DEFAULT_BASE_URL}/api/v1/services/aigc/multimodal-generation/generation`,
    );
    expect(new Headers(call.init.headers).get("Authorization")).toBe("Bearer test-dashscope-key");
    expect(new Headers(call.init.headers).get("X-DashScope-Async")).toBeNull();

    const body = JSON.parse(String(call.init.body)) as {
      model: string;
      input: { messages: Array<{ role: string; text: string; image: string[] }> };
      parameters: { size: string; n: number; watermark: boolean };
    };
    expect(body.model).toBe(WANXIANG_DEFAULT_MODEL);
    expect(body.input.messages).toHaveLength(1);
    expect(body.input.messages[0]!.role).toBe("user");
    expect(body.input.messages[0]!.text).toBe("generic prompt");
    // Official rule: the output aspect ratio follows the LAST input image, so
    // the composition frame must sit at the END (references first).
    const images = body.input.messages[0]!.image;
    expect(images).toHaveLength(3);
    expect(images[0]).toMatch(/^data:image\/png;base64,/);
    expect(images[1]).toMatch(/^data:image\/webp;base64,/);
    expect(images[2]).toMatch(/^data:image\/png;base64,/);
    expect(body.parameters).toEqual({ size: "2K", n: 1, watermark: false });

    expect(artifact.adapterId).toBe("wanxiang");
    expect([...new Uint8Array(await artifact.image.arrayBuffer())]).toEqual([...RESULT_BYTES]);
    expect(artifact.metadata.provider).toBe("wanxiang");
    expect(artifact.metadata.requestId).toBe("req-1");
  });

  it("downloads a plain-URL result through the same injected fetch", async () => {
    const { impl, calls } = fakeFetch([
      () => syncBody({ image: "https://result.example.test/frame.png" }),
      () =>
        new Response(new Blob([RESULT_BYTES as BlobPart], { type: "image/png" }), { status: 200 }),
    ]);
    const artifact = await adapterWith(impl).generate(baseInput());
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe("https://result.example.test/frame.png");
    expect(artifact.image.type).toBe("image/png");
    expect([...new Uint8Array(await artifact.image.arrayBuffer())]).toEqual([...RESULT_BYTES]);
  });

  it("supports the workspace-dedicated domain override", async () => {
    const { impl, calls } = fakeFetch([
      () => syncBody({ image: `data:image/png;base64,${bytesToBase64(RESULT_BYTES)}` }),
    ]);
    const adapter = new WanxiangImageGenerationAdapter({
      apiKey: "k",
      baseUrl: "https://ws-123.cn-beijing.maas.aliyuncs.com",
      fetchImpl: impl,
    });
    await adapter.generate(baseInput());
    expect(calls[0]!.url).toBe(
      "https://ws-123.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    );
  });

  it("refuses an empty API key at construction time", () => {
    expect(() => new WanxiangImageGenerationAdapter({ apiKey: "" })).toThrow(/DashScope API key/);
  });

  it("fails generation when the result download errors", async () => {
    const { impl } = fakeFetch([
      () => syncBody({ image: "https://result.example.test/frame.png" }),
      () => new Response("gone", { status: 404 }),
    ]);
    await expect(adapterWith(impl).generate(baseInput())).rejects.toThrow(/download failed/);
  });
});

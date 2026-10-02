import { describe, expect, it } from "vitest";

import {
  WANXIANG_DEFAULT_BASE_URL,
  WANXIANG_DEFAULT_MODEL,
  WANXIANG_MAX_INPUT_IMAGES,
  WanxiangImageGenerationAdapter,
} from "../../src/adapters/image-generation/wanxiang";
import {
  ProviderHttpError,
  ProviderOutcomeUnknownError,
  ProviderResultDeliveryError,
  ProviderUrlError,
} from "../../src/adapters/image-generation/provider-http";
import { bytesToBase64, dataUrlToBytes } from "../../src/adapters/image-generation/binary";
import type { ImageGenerationInput } from "../../src/adapters/image-generation/types";

/**
 * Wan 2.7 (Alibaba DashScope) adapter contract tests — Prompt 7B2, rewritten
 * in the acceptance fix round (2026-09-23) against the OFFICIAL request
 * contract (help.aliyun.com/zh/model-studio/
 * wan-image-generation-and-editing-api-reference): the prompt text and the
 * input images are separate objects inside input.messages[0].content.
 * Fully faked fetch: zero network, zero credentials, zero cost.
 */

/**
 * Placeholder key material for contract tests ONLY: an obviously non-secret
 * fixture value (never a real credential — none exists in this repository),
 * passed to an adapter whose fetch is fully faked, so it can never reach any
 * network. Assembled from parts to make its non-credential nature explicit.
 */
const FIXTURE_API_KEY = ["test", "dashscope", "key"].join("-");

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
  return { impl, calls, attempts: () => attempt };
}

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const RESULT_BYTES = new Uint8Array([1, 2, 3, 250]);

function blobOf(bytes: number[], type: string): Blob {
  return new Blob([new Uint8Array(bytes) as BlobPart], { type });
}

function baseInput(): ImageGenerationInput {
  return {
    compositionImage: blobOf([9], "image/png"),
    characterReferences: [blobOf([1], "image/png")],
    styleReference: blobOf([2], "image/webp"),
    prompt: "generic prompt",
  };
}

function adapterWith(impl: typeof fetch) {
  return new WanxiangImageGenerationAdapter({ apiKey: FIXTURE_API_KEY, fetchImpl: impl });
}

function syncBody(image: { image: string }) {
  return okResponse({
    output: { choices: [{ message: { content: [image] } }] },
    request_id: "req-1",
  });
}

function inlineResult() {
  return syncBody({ image: `data:image/png;base64,${bytesToBase64(RESULT_BYTES)}` });
}

interface ContentEntry {
  image?: string;
  text?: string;
}

interface WanRequestBody {
  model: string;
  input: {
    messages: Array<{ role: string; content?: ContentEntry[]; text?: string; image?: string[] }>;
  };
  parameters: { size: string; n: number; watermark: boolean };
}

function parseBody(call: RecordedCall): WanRequestBody {
  return JSON.parse(String(call.init.body)) as WanRequestBody;
}

/** Decodes a data-URL content image back to its exact bytes (not just the MIME prefix). */
function contentImageBytes(entry: ContentEntry): number[] {
  const data = dataUrlToBytes(entry.image ?? "");
  expect(data).not.toBeNull();
  return [...data!.bytes];
}

describe("WanxiangImageGenerationAdapter request contract (official content array)", () => {
  it("sends images and text as separate objects in messages[0].content, composition image LAST", async () => {
    const { impl, calls } = fakeFetch([inlineResult]);
    const artifact = await adapterWith(impl).generate(baseInput());

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(
      `${WANXIANG_DEFAULT_BASE_URL}/api/v1/services/aigc/multimodal-generation/generation`,
    );
    expect(new Headers(call.init.headers).get("Authorization")).toBe(`Bearer ${FIXTURE_API_KEY}`);
    expect(new Headers(call.init.headers).get("X-DashScope-Async")).toBeNull();

    const body = parseBody(call);
    expect(body.model).toBe(WANXIANG_DEFAULT_MODEL);
    expect(body.input.messages).toHaveLength(1);
    const message = body.input.messages[0]!;
    expect(message.role).toBe("user");

    // The official contract: content exists as an array of {image}/{text}
    // objects; the legacy top-level text/image fields must NOT be present.
    expect(Array.isArray(message.content)).toBe(true);
    expect(message.text).toBeUndefined();
    expect(message.image).toBeUndefined();

    const imageEntries = message.content!.filter((entry) => entry.image !== undefined);
    const textEntries = message.content!.filter((entry) => entry.text !== undefined);
    expect(textEntries).toEqual([{ text: "generic prompt" }]);
    // Each image entry carries ONLY the image key.
    for (const entry of imageEntries) {
      expect(Object.keys(entry)).toEqual(["image"]);
    }

    // Exact content correspondence (decoded bytes, not MIME prefixes):
    // character reference, then style reference, then the composition frame
    // LAST (official rule: the output aspect ratio follows the last image).
    expect(imageEntries).toHaveLength(3);
    expect(contentImageBytes(imageEntries[0]!)).toEqual([1]);
    expect(imageEntries[0]!.image).toMatch(/^data:image\/png;base64,/);
    expect(contentImageBytes(imageEntries[1]!)).toEqual([2]);
    expect(imageEntries[1]!.image).toMatch(/^data:image\/webp;base64,/);
    expect(contentImageBytes(imageEntries[2]!)).toEqual([9]);
    expect(imageEntries[2]!.image).toMatch(/^data:image\/png;base64,/);
    // The text object may sit after the images (composition stays the last IMAGE).
    expect(message.content!.indexOf(imageEntries[2]!)).toBeLessThan(
      message.content!.indexOf(textEntries[0]!),
    );

    expect(body.parameters).toEqual({ size: "2K", n: 1, watermark: false });
    expect(artifact.adapterId).toBe("wanxiang");
    expect(artifact.adapterVersion).toBe("1.1.0");
    expect([...new Uint8Array(await artifact.image.arrayBuffer())]).toEqual([...RESULT_BYTES]);
    expect(artifact.metadata.provider).toBe("wanxiang");
    expect(artifact.metadata.requestId).toBe("req-1");
    expect(artifact.metadata.totalInputImages).toBe("3");
  });

  it("sends a single content {image} when only the composition is given", async () => {
    const { impl, calls } = fakeFetch([inlineResult]);
    await adapterWith(impl).generate({
      compositionImage: blobOf([7], "image/png"),
      prompt: "composition only",
    });
    const message = parseBody(calls[0]!).input.messages[0]!;
    expect(message.text).toBeUndefined();
    expect(message.image).toBeUndefined();
    const imageEntries = message.content!.filter((entry) => entry.image !== undefined);
    expect(imageEntries).toHaveLength(1);
    expect(contentImageBytes(imageEntries[0]!)).toEqual([7]);
    expect(message.content).toContainEqual({ text: "composition only" });
  });

  it("keeps the composition LAST with character references and no style image", async () => {
    const { impl, calls } = fakeFetch([inlineResult]);
    await adapterWith(impl).generate({
      compositionImage: blobOf([9], "image/png"),
      characterReferences: [blobOf([1], "image/png"), blobOf([2], "image/jpeg")],
      prompt: "two references",
    });
    const message = parseBody(calls[0]!).input.messages[0]!;
    const imageEntries = message.content!.filter((entry) => entry.image !== undefined);
    expect(imageEntries).toHaveLength(3);
    expect(contentImageBytes(imageEntries[0]!)).toEqual([1]);
    expect(contentImageBytes(imageEntries[1]!)).toEqual([2]);
    expect(contentImageBytes(imageEntries[2]!)).toEqual([9]);
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
    const { impl, calls } = fakeFetch([inlineResult]);
    const adapter = new WanxiangImageGenerationAdapter({
      apiKey: FIXTURE_API_KEY,
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

  it("fails as a delivered-result failure when the result download errors", async () => {
    const { impl } = fakeFetch([
      () => syncBody({ image: "https://result.example.test/frame.png" }),
      () => new Response("gone", { status: 404 }),
    ]);
    const error = await adapterWith(impl)
      .generate(baseInput())
      .catch((caught) => caught);
    // The generation itself succeeded; only its delivery failed — the charge
    // warning class applies (acceptance R2-1).
    expect(error).toBeInstanceOf(ProviderResultDeliveryError);
    expect(error.message).toContain("HTTP 404");
    expect(error.outcomeUnknown).toBe(true);
  });

  it("maps a result-download network failure (not an abort) to a delivered-result failure", async () => {
    const impl = (async (url: RequestInfo | URL) => {
      if (String(url).includes("multimodal-generation")) {
        return syncBody({ image: "https://result.example.test/frame.png" });
      }
      throw new TypeError("download connection lost");
    }) as typeof fetch;
    const error = await adapterWith(impl)
      .generate(baseInput())
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ProviderResultDeliveryError);
    expect(error.message).toContain("download connection lost");
    expect(error.outcomeUnknown).toBe(true);
  });

  it("enforces the official total input-image limit defensively at the adapter boundary", async () => {
    const { impl, calls } = fakeFetch([inlineResult]);
    const input: ImageGenerationInput = {
      compositionImage: blobOf([9], "image/png"),
      characterReferences: Array.from({ length: WANXIANG_MAX_INPUT_IMAGES - 1 }, (_, index) =>
        blobOf([index], "image/png"),
      ),
      styleReference: blobOf([2], "image/png"),
      prompt: "over the total",
    };
    await expect(adapterWith(impl).generate(input)).rejects.toThrow(/at most 9 input images/);
    expect(calls).toHaveLength(0);
  });
});

describe("WanxiangImageGenerationAdapter submission and cancellation policy", () => {
  it("does NOT resubmit after a network failure — the outcome is unknown", async () => {
    const { impl, calls } = fakeFetch([
      () => new TypeError("connection lost after the provider accepted the request"),
    ]);
    await expect(adapterWith(impl).generate(baseInput())).rejects.toThrow(
      ProviderOutcomeUnknownError,
    );
    expect(calls).toHaveLength(1);
  });

  it("reports an outcome-unknown network failure with the charge warning", async () => {
    const { impl } = fakeFetch([() => new TypeError("fetch failed")]);
    const error = await adapterWith(impl)
      .generate(baseInput())
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ProviderOutcomeUnknownError);
    expect(error.message).toContain("outcome is unknown");
    expect(error.message).toContain("additional charge");
  });

  it("does NOT resubmit when reading the accepted response body fails", async () => {
    const brokenBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError("connection reset while reading the body"));
      },
    });
    const { impl, calls } = fakeFetch([
      () =>
        new Response(brokenBody, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ]);
    await expect(adapterWith(impl).generate(baseInput())).rejects.toThrow(
      ProviderOutcomeUnknownError,
    );
    expect(calls).toHaveLength(1);
  });

  it("does NOT resubmit a 5xx response — an error status does not prove non-execution", async () => {
    const { impl, calls } = fakeFetch([() => new Response("bad gateway", { status: 502 })]);
    await expect(adapterWith(impl).generate(baseInput())).rejects.toThrow(ProviderHttpError);
    expect(calls).toHaveLength(1);
  });

  it("retries ONLY the 429 rate-limit status, then succeeds", async () => {
    const delays: number[] = [];
    const { impl, attempts } = fakeFetch([
      () => new Response("rate limited", { status: 429 }),
      inlineResult,
    ]);
    const adapter = new WanxiangImageGenerationAdapter({
      apiKey: FIXTURE_API_KEY,
      fetchImpl: impl,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    await adapter.generate(baseInput());
    expect(attempts()).toBe(2);
    expect(delays).toEqual([500]);
  });

  it("cancels the result-image download when the total budget expires", async () => {
    // A fetch that behaves like the real one: an in-flight request rejects
    // with the abort reason when its signal fires.
    const calls: RecordedCall[] = [];
    const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (calls.length === 1) {
        return syncBody({ image: "https://result.example.test/frame.png" });
      }
      return await new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (signal == null) {
          return; // hangs forever — the abort path below is the only exit
        }
        signal.addEventListener(
          "abort",
          () => reject(signal.reason ?? new Error("download aborted")),
          { once: true },
        );
      });
    }) as typeof fetch;
    const controller = new AbortController();
    const adapter = new WanxiangImageGenerationAdapter({
      apiKey: FIXTURE_API_KEY,
      fetchImpl: impl,
    });
    const deadlineAt = Date.now() + 20;
    const pending = adapter.generate(baseInput(), { signal: controller.signal, deadlineAt });
    const guard = pending.catch(() => {
      /* asserted below through the same promise */
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    controller.abort(new Error("total budget exhausted"));
    await expect(pending).rejects.toThrow(/total budget exhausted/);
    await guard;
    // The download fetch received the cancellation signal.
    expect((calls[1]!.init as { signal?: AbortSignal }).signal?.aborted).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("does not start the result download after the budget has expired", async () => {
    const { impl, calls } = fakeFetch([
      () => syncBody({ image: "https://result.example.test/frame.png" }),
    ]);
    const controller = new AbortController();
    controller.abort(new Error("total budget exhausted"));
    const adapter = new WanxiangImageGenerationAdapter({
      apiKey: FIXTURE_API_KEY,
      fetchImpl: impl,
    });
    await expect(
      adapter.generate(baseInput(), {
        signal: controller.signal,
        deadlineAt: Date.now() - 1,
      }),
    ).rejects.toThrow();
    // The generation POST is refused by the pre-attempt abort check, and the
    // download must never start in any case.
    expect(calls.length).toBeLessThanOrEqual(1);
  });

  it("rejects a misconfigured base URL pointing at a private target", async () => {
    const { impl } = fakeFetch([inlineResult]);
    const adapter = new WanxiangImageGenerationAdapter({
      apiKey: FIXTURE_API_KEY,
      baseUrl: "http://127.0.0.1:8080",
      fetchImpl: impl,
    });
    await expect(adapter.generate(baseInput())).rejects.toThrow(ProviderUrlError);
    // The result-download URL is guarded by the same policy — but AFTER a
    // successful generation it surfaces as a delivered-result failure (the
    // generation ran and may be billed; its result was not delivered).
    const adapter2 = new WanxiangImageGenerationAdapter({
      apiKey: FIXTURE_API_KEY,
      baseUrl: "https://ws.example.test",
      fetchImpl: fakeFetch([() => syncBody({ image: "http://169.254.169.254/latest/meta-data" })])
        .impl,
    });
    const error = await adapter2.generate(baseInput()).catch((caught) => caught);
    expect(error).toBeInstanceOf(ProviderResultDeliveryError);
    expect(error.outcomeUnknown).toBe(true);
    expect(error.message).toContain("169.254.169.254");
  });
});

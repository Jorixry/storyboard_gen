import { describe, expect, it } from "vitest";
import { MockImageGenerationAdapter } from "@/adapters/image-generation/mock";
import type { ImageGenerationInput } from "@/adapters/image-generation/types";

function textBlob(text: string): Blob {
  return new Blob([text], { type: "text/plain" });
}

function sampleInput(overrides: Partial<ImageGenerationInput> = {}): ImageGenerationInput {
  return {
    compositionImage: textBlob("composition-frame"),
    prompt: "ots a to b, 50mm, dolly in",
    ...overrides,
  };
}

describe("MockImageGenerationAdapter", () => {
  it("is deterministic for identical input", async () => {
    const adapter = new MockImageGenerationAdapter();
    const a = await adapter.generate(sampleInput());
    const b = await adapter.generate(sampleInput());
    expect(await a.image.text()).toBe(await b.image.text());
    expect(a.metadata).toEqual(b.metadata);
  });

  it("changes output when input changes", async () => {
    const adapter = new MockImageGenerationAdapter();
    const a = await adapter.generate(sampleInput());
    const b = await adapter.generate(sampleInput({ prompt: "different prompt" }));
    expect(a.metadata.signature).not.toBe(b.metadata.signature);
  });

  it("accounts for character and style references", async () => {
    const adapter = new MockImageGenerationAdapter();
    const withRefs = await adapter.generate(
      sampleInput({
        characterReferences: [textBlob("ref-a"), textBlob("ref-b")],
        styleReference: textBlob("style"),
      }),
    );
    const withoutRefs = await adapter.generate(sampleInput());
    expect(withRefs.metadata.signature).not.toBe(withoutRefs.metadata.signature);
    expect(withRefs.metadata.referenceCount).toBe("2");
    expect(withRefs.metadata.hasStyleReference).toBe("true");
  });

  it("reports stable adapter identity and metadata", async () => {
    const adapter = new MockImageGenerationAdapter();
    const result = await adapter.generate(sampleInput());
    expect(result.adapterId).toBe("mock-image-generation");
    expect(result.adapterVersion).toBe("1.0.0");
    expect(result.metadata.promptLengthBytes).toBe(String(sampleInput().prompt.length));
  });

  it("does not access fetch, XMLHttpRequest or environment credentials", async () => {
    const originalFetch = globalThis.fetch;
    const usedEnv: string[] = [];
    const originalEnv = process.env;
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      throw new Error("mock adapter must not perform network requests");
    }) as typeof fetch;
    process.env = new Proxy(originalEnv, {
      get(target, prop) {
        usedEnv.push(String(prop));
        return target[prop as keyof typeof target];
      },
    });
    try {
      const adapter = new MockImageGenerationAdapter();
      await adapter.generate(sampleInput());
      expect(fetchCalled).toBe(false);
      expect(usedEnv).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      process.env = originalEnv;
    }
  });
});

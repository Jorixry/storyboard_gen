import { describe, expect, it } from "vitest";
import { MockVideoPromptAdapter } from "@/adapters/video-prompts/mock";
import type { NormalizedShotSpec } from "@/adapters/video-prompts/types";

function sampleSpec(overrides: Partial<NormalizedShotSpec> = {}): NormalizedShotSpec {
  return {
    templateId: "dialogue_ots_a_to_b",
    templateVersion: 1,
    aspectRatio: "9:16",
    focalLengthMm: 50,
    movementType: "dolly_in",
    primarySubject: "character_b",
    ...overrides,
  };
}

describe("MockVideoPromptAdapter", () => {
  it("is deterministic for identical input", async () => {
    const adapter = new MockVideoPromptAdapter();
    const a = await adapter.compile(sampleSpec());
    const b = await adapter.compile(sampleSpec());
    expect(a).toEqual(b);
  });

  it("derives prompt text from structured semantics, not free-form input", async () => {
    const adapter = new MockVideoPromptAdapter();
    const result = await adapter.compile(sampleSpec());
    expect(result.prompt).toContain("template=dialogue_ots_a_to_b@v1");
    expect(result.prompt).toContain("aspect=9:16");
    expect(result.prompt).toContain("focal=50mm");
    expect(result.prompt).toContain("movement=slow dolly in");
    expect(result.prompt).toContain("character B as the primary subject");
  });

  it("reflects every structured field change in the output", async () => {
    const adapter = new MockVideoPromptAdapter();
    const base = await adapter.compile(sampleSpec());
    const changed = await adapter.compile(
      sampleSpec({ focalLengthMm: 35, movementType: "static", aspectRatio: "16:9" }),
    );
    expect(changed.prompt).not.toBe(base.prompt);
    expect(changed.prompt).toContain("focal=35mm");
    expect(changed.prompt).toContain("movement=static camera");
    expect(changed.prompt).toContain("aspect=16:9");
  });

  it("reports a warning for invalid focal length without throwing", async () => {
    const adapter = new MockVideoPromptAdapter();
    const result = await adapter.compile(sampleSpec({ focalLengthMm: 0 }));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("invalid focal length");
  });

  it("reports stable adapter identity", async () => {
    const adapter = new MockVideoPromptAdapter();
    const result = await adapter.compile(sampleSpec());
    expect(result.adapterId).toBe("mock-video-prompt");
    expect(result.adapterVersion).toBe("0.1.0");
  });

  it("does not access fetch or environment credentials", async () => {
    const originalFetch = globalThis.fetch;
    const originalEnv = process.env;
    const usedEnv: string[] = [];
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
      const adapter = new MockVideoPromptAdapter();
      await adapter.compile(sampleSpec());
      expect(fetchCalled).toBe(false);
      expect(usedEnv).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      process.env = originalEnv;
    }
  });
});

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  SEEDANCE_VIDEO_ADAPTER_ID,
  SEEDANCE_VIDEO_ADAPTER_VERSION,
  SeedanceVideoPromptAdapter,
} from "../../src/adapters/video-prompts/seedance";
import type { NormalizedShotSpec } from "../../src/adapters/video-prompts/types";
import { normalizeShotState } from "../../src/domain/prompt-normalization";
import {
  createShotStateFromTemplate,
  shotStateSchema,
  type ShotState,
} from "../../src/domain/shot-state";
import type { VideoPromptAdapterConfig } from "../../src/domain/video-adapter-config";
import { validateContent } from "../../scripts/lib/content-validation";
import { projectRoot, loadRealTemplates } from "../helpers/content-test-utils";

/**
 * Seedance target-model prompt adapter (Prompt 8, developer option a).
 * Snapshot evidence: the three development templates compile byte-exactly to
 * the committed golden prompts. Invariant evidence: the engineering-derived /
 * no-official-support labeling, the descriptive (non-parametrized) camera
 * language, determinism, purity and refusal semantics of the config gate.
 */

const FIXED_ID = "shot-prompt8-ots-a-to-b";
const GOLDEN_IDS: Record<string, string> = {
  dialogue_medium_two_shot: "shot-prompt8-medium",
  dialogue_ots_a_to_b: "shot-prompt8-ots-a-to-b",
  dialogue_ots_b_to_a: "shot-prompt8-ots-b-to-a",
};

async function realAdapterConfig(): Promise<VideoPromptAdapterConfig> {
  const { adapterConfigs, issues } = await validateContent(path.join(projectRoot, "content"));
  if (issues.length > 0) {
    throw new Error(`real content failed validation: ${JSON.stringify(issues)}`);
  }
  const config = adapterConfigs.find((candidate) => candidate.id === SEEDANCE_VIDEO_ADAPTER_ID);
  if (config === undefined) {
    throw new Error("seedance_video adapter config missing from content/adapters/");
  }
  return config;
}

async function realAdapter(): Promise<SeedanceVideoPromptAdapter> {
  return new SeedanceVideoPromptAdapter(await realAdapterConfig());
}

async function stateFromTemplate(templateId: string, id = FIXED_ID): Promise<ShotState> {
  const template = (await loadRealTemplates()).find((t) => t.id === templateId);
  if (template === undefined) {
    throw new Error(`template ${templateId} not found`);
  }
  return createShotStateFromTemplate(template, { generateId: () => id });
}

async function readGoldenPrompt(templateId: string): Promise<string> {
  return readFile(
    path.join(projectRoot, "tests", "fixtures", "prompts", `${templateId}.seedance-prompt.txt`),
    "utf8",
  );
}

function deepFreeze<T extends object>(value: T): T {
  for (const key of Object.getOwnPropertyNames(value)) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== null && typeof child === "object") {
      deepFreeze(child as object);
    }
  }
  return Object.freeze(value);
}

describe("SeedanceVideoPromptAdapter golden snapshots", () => {
  it("compiles all three development templates byte-exactly to the committed golden prompts", async () => {
    const adapter = await realAdapter();
    for (const templateId of Object.keys(GOLDEN_IDS)) {
      const state = await stateFromTemplate(templateId, GOLDEN_IDS[templateId]!);
      const result = await adapter.compile(normalizeShotState(state));
      expect(result.prompt).toBe(await readGoldenPrompt(templateId));
    }
  });

  it("produces the exact deterministic warnings for dialogue_ots_a_to_b", async () => {
    // D031: approved template — no reviewStatus warning; an engineering
    // template still gets one (asserted in the next test).
    const state = await stateFromTemplate("dialogue_ots_a_to_b");
    const result = await (await realAdapter()).compile(normalizeShotState(state));
    expect(result.warnings).toEqual([]);
  });

  it("still warns the reviewStatus mismatch for engineering_ready templates (medium)", async () => {
    const state = await stateFromTemplate("dialogue_medium_two_shot");
    const result = await (await realAdapter()).compile(normalizeShotState(state));
    expect(result.warnings).toContainEqual(
      'template: reviewStatus "engineering_ready" is not "approved"; directing semantics are engineering-derived and not professionally verified',
    );
  });

  it("warns when a movement is declared but the poses are identical (medium template edited)", async () => {
    const medium = await stateFromTemplate("dialogue_medium_two_shot");
    const moving = shotStateSchema.parse({
      ...medium,
      movement: { ...medium.movement, type: "dolly_in" },
    });
    const result = await (await realAdapter()).compile(normalizeShotState(moving));
    expect(result.warnings).toContainEqual(
      "movement: type=dolly_in is declared but start and end poses are identical; no displacement is expressed",
    );
  });

  it("warns when type=static but the poses differ (OTS template edited)", async () => {
    const ots = await stateFromTemplate("dialogue_ots_a_to_b");
    const frozenType = shotStateSchema.parse({
      ...ots,
      movement: { ...ots.movement, type: "static" },
    });
    const result = await (await realAdapter()).compile(normalizeShotState(frozenType));
    expect(result.warnings).toContainEqual(
      "movement: type=static but start and end poses differ (position); " +
        "the exported start/end guide images still express both poses verbatim",
    );
  });
});

describe("SeedanceVideoPromptAdapter labeling and language invariants", () => {
  it("labels the output as engineering-derived and never claims official Seedance support", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b");
    const prompt = (await (await realAdapter()).compile(normalizeShotState(state))).prompt;
    expect(prompt).toMatch(/^seedance-prompt: engineering-derived target-model draft/);
    expect(prompt).toContain("NOT claiming official Seedance support");
    expect(prompt).toContain("D026 provisional");
    expect(prompt).toContain("protected-facts");
    // D031: the OTS template is approved, so the professional-verification
    // disclaimer is gone from its prompt; an engineering template keeps it.
    expect(prompt).not.toContain("NOT professionally verified");
    const engineering = await stateFromTemplate("dialogue_medium_two_shot");
    const engineeringPrompt = (await (await realAdapter()).compile(normalizeShotState(engineering)))
      .prompt;
    expect(engineeringPrompt).toContain("NOT professionally verified");
  });

  it("uses descriptive movement language and keeps parametrized numbers out of the prose", async () => {
    const ots = await stateFromTemplate("dialogue_ots_a_to_b");
    const prompt = (await (await realAdapter()).compile(normalizeShotState(ots))).prompt;
    expect(prompt).toContain("Shot 1: 镜头缓慢推近被摄主体（slow dolly in）");
    expect(prompt).toContain("画面: 单镜头，画幅 16:9，时长约 4 秒");
    // No coordinate vectors, no focal-mm facts in the Seedance prose (official
    // guidance: descriptive language). The optics SEMANTICS token stays — it
    // is director vocabulary, not a parametrized camera setting.
    expect(prompt).not.toContain("position=[");
    expect(prompt).not.toContain("target=[");
    expect(prompt).not.toContain("focal=75mm");
    expect(prompt).toContain("focal_75mm");
  });

  it("renders the static template with fixed-camera language", async () => {
    const medium = await stateFromTemplate("dialogue_medium_two_shot");
    const prompt = (await (await realAdapter()).compile(normalizeShotState(medium))).prompt;
    expect(prompt).toContain("Shot 1: 固定机位，画面保持稳定（static camera）");
    expect(prompt).toContain("时长约 4 秒");
  });
});

describe("SeedanceVideoPromptAdapter determinism and purity", () => {
  it("reports traceable metadata", async () => {
    const state = await stateFromTemplate("dialogue_ots_b_to_a");
    const result = await (await realAdapter()).compile(normalizeShotState(state));
    expect(result.adapterId).toBe(SEEDANCE_VIDEO_ADAPTER_ID);
    expect(result.adapterId).toBe("seedance_video");
    expect(result.adapterVersion).toBe(SEEDANCE_VIDEO_ADAPTER_VERSION);
    expect(result.adapterConfigVersion).toBe(1);
    expect(result.source).toEqual({
      shotStateId: FIXED_ID,
      shotStateSchemaVersion: 1,
      templateId: "dialogue_ots_b_to_a",
      templateVersion: 3,
      templateReviewStatus: "approved", // D031 written approval 2026-10-11
    });
  });

  it("returns identical results for repeated compiles and separate instances", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b");
    const adapterA = await realAdapter();
    const adapterB = await realAdapter();
    const first = await adapterA.compile(normalizeShotState(state));
    const second = await adapterA.compile(normalizeShotState(state));
    const other = await adapterB.compile(normalizeShotState(state));
    expect(second).toEqual(first);
    expect(other).toEqual(first);
  });

  it("rejects a malformed spec instead of compiling partially", async () => {
    const adapter = await realAdapter();
    const spec = normalizeShotState(await stateFromTemplate("dialogue_ots_a_to_b"));
    const malformed: NormalizedShotSpec = {
      ...spec,
      camera: { ...spec.camera, focalLengthMm: 0 },
    };
    await expect(adapter.compile(malformed)).rejects.toThrowError(/focalLengthMm/);
  });

  it("does not mutate the normalized input", async () => {
    const adapter = await realAdapter();
    const spec = deepFreeze(normalizeShotState(await stateFromTemplate("dialogue_ots_a_to_b")));
    await expect(adapter.compile(spec)).resolves.toBeTruthy();
  });

  it("drives the semantics section order from the config ordering", async () => {
    const config = await realAdapterConfig();
    const reordered: VideoPromptAdapterConfig = {
      ...config,
      ordering: ["motion", "continuity", "subjects", "composition", "optics"],
    };
    const adapter = new SeedanceVideoPromptAdapter(reordered);
    const state = await stateFromTemplate("dialogue_ots_a_to_b");
    const lines = (await adapter.compile(normalizeShotState(state))).prompt.split("\n");
    const indexOf = (prefix: string) => lines.findIndex((line) => line.startsWith(`${prefix}:`));
    expect(indexOf("motion")).toBeLessThan(indexOf("continuity"));
    expect(indexOf("continuity")).toBeLessThan(indexOf("subjects"));
    expect(indexOf("subjects")).toBeLessThan(indexOf("composition"));
    expect(indexOf("composition")).toBeLessThan(indexOf("optics"));
  });

  it("refuses a config authored for another adapter id and an unpreserving one", async () => {
    const config = await realAdapterConfig();
    expect(() => new SeedanceVideoPromptAdapter({ ...config, id: "generic_video" })).toThrowError(
      /seedance_video/,
    );
    expect(
      () =>
        new SeedanceVideoPromptAdapter({
          ...config,
          constraints: { ...config.constraints, preserveStructuredFacts: false },
        }),
    ).toThrowError(/preserveStructuredFacts/);
  });
});

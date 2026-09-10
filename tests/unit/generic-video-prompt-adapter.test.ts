import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  GENERIC_VIDEO_ADAPTER_ID,
  GENERIC_VIDEO_ADAPTER_VERSION,
  GenericVideoPromptAdapter,
} from "../../src/adapters/video-prompts/generic";
import type { CompiledPrompt, NormalizedShotSpec } from "../../src/adapters/video-prompts/types";
import {
  makeCloser,
  setAspectRatio,
  setCameraFocalLength,
  setCameraTarget,
  setCharacterPosition,
  setCharacterYaw,
} from "../../src/domain/commands";
import { normalizeShotState } from "../../src/domain/prompt-normalization";
import {
  createShotStateFromTemplate,
  shotStateSchema,
  type ShotState,
} from "../../src/domain/shot-state";
import type { VideoPromptAdapterConfig } from "../../src/domain/video-adapter-config";
import { compileVideoPrompt } from "../../src/features/prompt-compiler/compile";
import { validateContent } from "../../scripts/lib/content-validation";
import { projectRoot, realContentDir, loadRealTemplates } from "../helpers/content-test-utils";

/**
 * Generic (mock/generic, model-agnostic) VideoPromptAdapter — Prompt 6.
 *
 * Snapshot evidence: the three development templates compile byte-exactly to
 * the committed golden prompts; invariant evidence: fact reflection, distinct
 * current/movement poses, conflict and unknown-token warnings, metadata
 * accuracy, determinism, purity and no network/env access.
 */

const FIXED_ID = "shot-prompt6-ots-a-to-b";
const GOLDEN_IDS: Record<string, string> = {
  dialogue_medium_two_shot: "shot-prompt6-medium",
  dialogue_ots_a_to_b: "shot-prompt6-ots-a-to-b",
  dialogue_ots_b_to_a: "shot-prompt6-ots-b-to-a",
};

async function realAdapterConfig(): Promise<VideoPromptAdapterConfig> {
  const { adapterConfigs, issues } = await validateContent(realContentDir);
  if (issues.length > 0) {
    throw new Error(`real content failed validation: ${JSON.stringify(issues)}`);
  }
  const config = adapterConfigs.find((candidate) => candidate.id === GENERIC_VIDEO_ADAPTER_ID);
  if (config === undefined) {
    throw new Error("generic_video adapter config missing from content/adapters/");
  }
  return config;
}

async function realAdapter(): Promise<GenericVideoPromptAdapter> {
  return new GenericVideoPromptAdapter(await realAdapterConfig());
}

async function stateFromTemplate(templateId: string, id = FIXED_ID): Promise<ShotState> {
  const template = (await loadRealTemplates()).find((t) => t.id === templateId);
  if (template === undefined) {
    throw new Error(`template ${templateId} not found`);
  }
  return createShotStateFromTemplate(template, { generateId: () => id });
}

async function compileState(state: ShotState): Promise<CompiledPrompt> {
  const adapter = await realAdapter();
  return adapter.compile(normalizeShotState(state));
}

async function readGoldenPrompt(templateId: string): Promise<string> {
  return readFile(
    path.join(projectRoot, "tests", "fixtures", "prompts", `${templateId}.generic-prompt.txt`),
    "utf8",
  );
}

function semanticsBlock(prompt: string): string[] {
  return prompt.split("\n").slice(-5);
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

describe("GenericVideoPromptAdapter golden snapshots", () => {
  it("compiles all three development templates byte-exactly to the committed golden prompts", async () => {
    const adapter = await realAdapter();
    for (const templateId of Object.keys(GOLDEN_IDS)) {
      const state = await stateFromTemplate(templateId, GOLDEN_IDS[templateId]!);
      const result = await adapter.compile(normalizeShotState(state));
      expect(result.prompt).toBe(await readGoldenPrompt(templateId));
    }
  });

  it("produces the exact deterministic warnings (order included) for dialogue_ots_a_to_b", async () => {
    const result = await compileState(await stateFromTemplate("dialogue_ots_a_to_b"));
    expect(result.warnings).toEqual([
      'template: reviewStatus "engineering_ready" is not "approved"; directing semantics are engineering-derived and not professionally verified',
      "adapter-config: allowLlmPolish=true but LLM polish is not implemented; output is deterministic text only (llmMayChange: wording, grammar)",
      "semantics: 11 token(s) have no generic-adapter interpretation; rendered verbatim without invented meaning " +
        "(subjects[1]=character_a_shoulder_soft_foreground, composition[0]=over_the_shoulder, " +
        "composition[1]=character_a_shoulder_left_foreground, composition[2]=character_b_chest_up_framing, " +
        "composition[3]=eyes_upper_third, optics[0]=medium_close_up, optics[2]=soft_foreground, " +
        "continuity[0]=maintain_axis, continuity[1]=preserve_eyeline, continuity[2]=foreground_shoulder_frame, " +
        "continuity[3]=matched_reverse_pair)",
    ]);
  });

  it("renders the semantics block in the exact format of the committed semantic-reference fixture", async () => {
    const result = await compileState(await stateFromTemplate("dialogue_ots_a_to_b"));
    const reference = await readFile(
      path.join(projectRoot, "tests", "fixtures", "prompts", "dialogue_ots_a_to_b.generic.txt"),
      "utf8",
    );
    expect(semanticsBlock(result.prompt).join("\n")).toBe(reference.trimEnd());
  });

  it("labels the output as model-agnostic engineering output with no provider claim", async () => {
    const result = await compileState(await stateFromTemplate("dialogue_ots_a_to_b"));
    expect(result.prompt).toMatch(/^generic-video-prompt: model-agnostic engineering reference/);
    expect(result.prompt).toContain(
      "not tuned for and not claiming support of any specific video model",
    );
    expect(result.prompt.toLowerCase()).not.toContain("seedance");
    expect(result.prompt).toContain("NOT professionally verified");
  });
});

describe("GenericVideoPromptAdapter metadata and determinism", () => {
  it("reports the adapter identity, config version and traceable source metadata", async () => {
    const state = await stateFromTemplate("dialogue_ots_b_to_a");
    const result = await compileState(state);
    expect(result.adapterId).toBe(GENERIC_VIDEO_ADAPTER_ID);
    expect(result.adapterId).toBe("generic_video");
    expect(result.adapterVersion).toBe(GENERIC_VIDEO_ADAPTER_VERSION);
    expect(result.adapterConfigVersion).toBe(1);
    expect(result.source).toEqual({
      shotStateId: FIXED_ID,
      shotStateSchemaVersion: 1,
      templateId: "dialogue_ots_b_to_a",
      templateVersion: 2, // OTS bumped to v2 by the D025 75mm change
      templateReviewStatus: "engineering_ready",
    });
  });

  it("returns identical full results for repeated compiles and separate instances", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b");
    const adapterA = await realAdapter();
    const adapterB = await realAdapter();
    const first = await adapterA.compile(normalizeShotState(state));
    const second = await adapterA.compile(normalizeShotState(state));
    const other = await adapterB.compile(normalizeShotState(state));
    expect(second).toEqual(first);
    expect(other).toEqual(first);
  });

  it("rejects a malformed normalized spec instead of compiling partially", async () => {
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

  it("does not access fetch or environment credentials", async () => {
    // Everything touching the filesystem is prepared BEFORE the proxy window:
    // only the pure compile call runs inside it, so any env read observed
    // below comes from the adapter itself, not from test machinery.
    const adapter = await realAdapter();
    const spec = normalizeShotState(await stateFromTemplate("dialogue_medium_two_shot"));
    const originalFetch = globalThis.fetch;
    const originalEnv = process.env;
    const usedEnv: string[] = [];
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      throw new Error("generic adapter must not perform network requests");
    }) as typeof fetch;
    process.env = new Proxy(originalEnv, {
      get(target, prop) {
        usedEnv.push(String(prop));
        return target[prop as keyof typeof target];
      },
    });
    try {
      const result = await adapter.compile(spec);
      expect(result.prompt).toContain("aspect-ratio: 16:9");
      expect(fetchCalled).toBe(false);
      expect(usedEnv).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      process.env = originalEnv;
    }
  });
});

describe("GenericVideoPromptAdapter fact reflection", () => {
  it("reflects camera position, target, focal, character placement, yaw and aspect edits", async () => {
    let state = await stateFromTemplate("dialogue_ots_a_to_b");
    state = makeCloser(state); // [-0.84, 1.67, 1.6] for this template (20% toward target)
    state = setCameraTarget(state, [0.6, 1.55, 0]);
    state = setCameraFocalLength(state, 85);
    state = setCharacterPosition(state, "character_b", [0.6, 0, 0.2]);
    state = setCharacterYaw(state, "character_a", 45);
    state = setAspectRatio(state, "9:16");

    const result = await compileState(state);
    // Full state precision: makeCloser's exact lerp result, unrounded.
    expect(result.prompt).toContain("camera.current: position=[-0.8400000000000001, 1.67, 1.6]");
    expect(result.prompt).toContain("target=[0.6, 1.55, 0]");
    expect(result.prompt).toContain("focal=85mm");
    expect(result.prompt).toContain("character_b position=[0.6, 0, 0.2]");
    expect(result.prompt).toContain("character_a position=[-0.8, 0, 0] facing=45deg");
    expect(result.prompt).toContain("aspect-ratio: 9:16");
  });

  it("keeps the current camera, movement start and movement end as three distinct facts", async () => {
    const edited = makeCloser(await stateFromTemplate("dialogue_ots_a_to_b"));
    const result = await compileState(edited);
    expect(result.prompt).toContain("camera.current: position=[-0.8400000000000001, 1.67, 1.6]");
    expect(result.prompt).toContain("movement.start: position=[-1.25, 1.7, 2]");
    expect(result.prompt).toContain("movement.end: position=[-1.05, 1.68, 1.4]");
    // None of the movement poses was clobbered by the current-pose edit.
    expect(result.prompt).not.toContain(
      "movement.start: position=[-0.8400000000000001, 1.67, 1.6]",
    );
  });

  it("preserves movement type, duration and easing for static and supported movements", async () => {
    const medium = await stateFromTemplate("dialogue_medium_two_shot");
    const staticResult = await compileState(medium);
    expect(staticResult.prompt).toContain("movement: type=static duration=4s easing=linear");

    const retimed = shotStateSchema.parse({
      ...medium,
      movement: { ...medium.movement, durationSeconds: 6.5, easing: "ease_in_out" },
    });
    expect((await compileState(retimed)).prompt).toContain(
      "movement: type=static duration=6.5s easing=ease_in_out",
    );

    const trucked = shotStateSchema.parse({
      ...medium,
      movement: { ...medium.movement, type: "truck_right" },
    });
    expect((await compileState(trucked)).prompt).toContain("movement: type=truck_right");
  });
});

describe("GenericVideoPromptAdapter conflict and unknown-token warnings", () => {
  it("warns when a focal token contradicts the camera focal length; the number wins", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b");
    // Bypass the syncing command on purpose: semantics still says focal_75mm.
    const desynced = shotStateSchema.parse({
      ...state,
      camera: { ...state.camera, focalLengthMm: 85 },
    });
    const result = await compileState(desynced);
    expect(result.warnings).toContainEqual(
      'semantics.optics[1]: "focal_75mm" conflicts with camera.focalLengthMm=85mm; the structured number is authoritative',
    );
    expect(result.prompt).toContain("focal=85mm");
  });

  it("does not warn when the syncing command keeps the focal token aligned", async () => {
    const state = setCameraFocalLength(await stateFromTemplate("dialogue_ots_a_to_b"), 85);
    const result = await compileState(state);
    expect(result.prompt).toContain("focal_85mm");
    expect(result.prompt).not.toContain("focal_75mm");
    expect(result.warnings.join("\n")).not.toContain("conflicts with camera.focalLengthMm");
  });

  it("warns when a primary-subject token contradicts the camera target emphasis", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b"); // subjects: character_b_primary
    const reaimed = shotStateSchema.parse({
      ...state,
      camera: { ...state.camera, target: [-0.8, 1.55, 0] as [number, number, number] },
    });
    const result = await compileState(reaimed);
    expect(result.warnings).toContainEqual(
      'semantics.subjects[0]: "character_b_primary" conflicts with the camera target, which is ' +
        "nearest to character_a (0m vs 1.6m); camera geometry is authoritative",
    );
  });

  it("warns when a motion token names a different movement than movement.type", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b"); // motion: subtle_dolly_in
    const trucked = shotStateSchema.parse({
      ...state,
      movement: { ...state.movement, type: "truck_right" },
    });
    const result = await compileState(trucked);
    expect(result.warnings).toContainEqual(
      'semantics.motion[0]: "subtle_dolly_in" names movement "dolly_in" but movement.type=truck_right; ' +
        "the structured movement is authoritative",
    );
    expect(result.prompt).toContain("movement: type=truck_right");
  });

  it("warns when type=static but the start and end poses differ", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b"); // poses differ
    const frozenType = shotStateSchema.parse({
      ...state,
      movement: { ...state.movement, type: "static" },
    });
    const result = await compileState(frozenType);
    expect(result.warnings).toContainEqual(
      "movement: type=static but start and end poses differ (position); both poses are expressed verbatim",
    );
  });

  it("warns when a movement type is declared but start and end poses are identical", async () => {
    const medium = await stateFromTemplate("dialogue_medium_two_shot"); // identical poses
    const moving = shotStateSchema.parse({
      ...medium,
      movement: { ...medium.movement, type: "dolly_in" },
    });
    const result = await compileState(moving);
    expect(result.warnings).toContainEqual(
      "movement: type=dolly_in is declared but start and end poses are identical; no displacement is expressed",
    );
  });

  it("renders unknown semantic tokens verbatim and reports them in a locatable warning", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b");
    const withUnknown = shotStateSchema.parse({
      ...state,
      semantics: {
        ...state.semantics,
        composition: [...state.semantics.composition, "mystery_token_v2"],
      },
    });
    const result = await compileState(withUnknown);
    expect(result.prompt).toContain("eyes_upper_third; mystery_token_v2");
    expect(result.warnings.join("\n")).toContain("composition[4]=mystery_token_v2");
    expect(result.warnings.join("\n")).toMatch(
      /12 token\(s\) have no generic-adapter interpretation/,
    );
  });

  it("drops the unverified-content warning only when the template is director-approved", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b");
    const approved = shotStateSchema.parse({
      ...state,
      template: { ...state.template, reviewStatus: "approved" },
    });
    const result = await compileState(approved);
    expect(result.prompt).toContain("template review status is approved");
    expect(result.warnings.join("\n")).not.toContain('reviewStatus "engineering_ready"');
    expect(result.warnings).toHaveLength(2);
  });
});

describe("GenericVideoPromptAdapter full-precision numeric rendering (Prompt 6 fix)", () => {
  it("keeps a 62.123456mm focal exactly and in sync with the optics token", async () => {
    const state = setCameraFocalLength(await stateFromTemplate("dialogue_ots_a_to_b"), 62.123456);
    const result = await compileState(state);
    expect(result.prompt).toContain("focal=62.123456mm");
    expect(result.prompt).toContain("focal_62.123456mm");
    expect(result.warnings.join("\n")).not.toContain("conflicts with camera.focalLengthMm");
  });

  it("keeps a 6.123456-second duration exactly", async () => {
    const medium = await stateFromTemplate("dialogue_medium_two_shot");
    const retimed = shotStateSchema.parse({
      ...medium,
      movement: { ...medium.movement, durationSeconds: 6.123456 },
    });
    expect((await compileState(retimed)).prompt).toContain("duration=6.123456s");
  });

  it("renders start.x=0 and end.x=0.00001 as distinct, exact values", async () => {
    const medium = await stateFromTemplate("dialogue_medium_two_shot");
    const epsilonMove = shotStateSchema.parse({
      ...medium,
      movement: {
        ...medium.movement,
        type: "dolly_in",
        start: { ...medium.movement.start, position: [0, 1.6, 3.4] as [number, number, number] },
        end: { ...medium.movement.end, position: [0.00001, 1.6, 3.4] as [number, number, number] },
      },
    });
    const result = await compileState(epsilonMove);
    expect(result.prompt).toContain("movement.start: position=[0, 1.6, 3.4]");
    expect(result.prompt).toContain("movement.end: position=[0.00001, 1.6, 3.4]");
    const startLine = result.prompt.split("\n").find((line) => line.startsWith("movement.start"));
    const endLine = result.prompt.split("\n").find((line) => line.startsWith("movement.end"));
    expect(startLine).toBeDefined();
    expect(endLine).toBeDefined();
    expect(startLine).not.toBe(endLine);
  });

  it("never claims verbatim expression while rounding: a verbatim warning implies exact values", async () => {
    const medium = await stateFromTemplate("dialogue_medium_two_shot");
    // static + differing poses triggers the warning that claims both poses are
    // "expressed verbatim"; the exact 5-decimal end value must then be present.
    const differing = shotStateSchema.parse({
      ...medium,
      movement: {
        ...medium.movement,
        start: { ...medium.movement.start, position: [0, 1.6, 3.4] as [number, number, number] },
        end: { ...medium.movement.end, position: [0.00012, 1.6, 3.4] as [number, number, number] },
      },
    });
    const result = await compileState(differing);
    const joined = result.warnings.join("\n");
    expect(joined).toContain("both poses are expressed verbatim");
    expect(result.prompt).toContain("movement.start: position=[0, 1.6, 3.4]");
    expect(result.prompt).toContain("movement.end: position=[0.00012, 1.6, 3.4]");
  });
});

describe("GenericVideoPromptAdapter per-category token matching (Prompt 6 fix)", () => {
  it("does NOT interpret 'not_dolly_in' as a motion token (no substring inference)", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b"); // movement.type=dolly_in
    const withNegation = shotStateSchema.parse({
      ...state,
      semantics: { ...state.semantics, motion: ["not_dolly_in"] },
    });
    const result = await compileState(withNegation);
    expect(result.prompt).toContain("motion: not_dolly_in");
    const joined = result.warnings.join("\n");
    // No movement meaning was invented for the unknown token...
    expect(joined).not.toMatch(/not_dolly_in"( names| implies) movement/);
    // ...and it is reported verbatim in the uninterpreted aggregate.
    expect(joined).toContain("motion[0]=not_dolly_in");
    expect(joined).toMatch(/have no generic-adapter interpretation/);
  });

  it("does NOT interpret 'mystery_dolly_in_v99' as a motion token", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b");
    const withMystery = shotStateSchema.parse({
      ...state,
      semantics: { ...state.semantics, motion: ["mystery_dolly_in_v99"] },
    });
    const result = await compileState(withMystery);
    expect(result.prompt).toContain("motion: mystery_dolly_in_v99");
    const joined = result.warnings.join("\n");
    expect(joined).not.toMatch(/mystery_dolly_in_v99"( names| implies) movement/);
    expect(joined).toContain("motion[0]=mystery_dolly_in_v99");
  });

  it("reports a focal token in the WRONG category instead of silently accepting it", async () => {
    const state = setCameraFocalLength(await stateFromTemplate("dialogue_ots_a_to_b"), 50);
    // Current focal is 50mm (synced optics token focal_50mm); a stray
    // focal_85mm token in composition must NOT become a focal fact.
    const misplaced = shotStateSchema.parse({
      ...state,
      semantics: { ...state.semantics, composition: ["focal_85mm"] },
    });
    const result = await compileState(misplaced);
    expect(result.warnings).toContainEqual(
      'semantics.composition[0]: "focal_85mm" is a focal token but appears in "composition" ' +
        '(expected "optics"); kept verbatim and not interpreted; ' +
        "the executable fact remains camera.focalLengthMm",
    );
    // The camera focal stays the structured 50mm; no focal-conflict warning
    // fires for the misplaced token (that check belongs to optics only).
    expect(result.prompt).toContain("focal=50mm");
    expect(result.prompt).toContain("composition: focal_85mm");
    const joined = result.warnings.join("\n");
    expect(joined).not.toContain('semantics.composition[0]: "focal_85mm" conflicts');
  });

  it("keeps wrong-category and stale-token warnings consistent: only structured fields are authoritative", async () => {
    // Reviewer reproduction: camera 85mm, optics still carries the stale
    // template token focal_75mm, and a misplaced focal_50mm sits in
    // composition. Both warnings must appear in ONE compile and must agree
    // that camera.focalLengthMm — not any semantics category — is the
    // authority. The input semantics are never edited to hide the conflict.
    const state = await stateFromTemplate("dialogue_ots_a_to_b"); // optics[1]=focal_75mm
    const combined = shotStateSchema.parse({
      ...state,
      camera: { ...state.camera, focalLengthMm: 85 },
      semantics: { ...state.semantics, composition: ["focal_50mm"] },
    });
    const result = await compileState(combined);
    expect(result.warnings).toContainEqual(
      'semantics.composition[0]: "focal_50mm" is a focal token but appears in "composition" ' +
        '(expected "optics"); kept verbatim and not interpreted; ' +
        "the executable fact remains camera.focalLengthMm",
    );
    expect(result.warnings).toContainEqual(
      'semantics.optics[1]: "focal_75mm" conflicts with camera.focalLengthMm=85mm; ' +
        "the structured number is authoritative",
    );
    expect(result.prompt).toContain("focal=85mm");
    expect(result.prompt).toContain("composition: focal_50mm");
    // No warning may claim a semantics CATEGORY is an authority.
    const joined = result.warnings.join("\n");
    expect(joined).not.toContain('fact in "optics" stays authoritative');
    for (const category of ["subjects", "composition", "optics", "motion", "continuity"]) {
      expect(joined).not.toContain(`"${category}" stays authoritative`);
    }
  });

  it("still fact-checks focal tokens that sit in their home category", async () => {
    const state = setCameraFocalLength(await stateFromTemplate("dialogue_ots_a_to_b"), 50);
    const desyncedOptics = shotStateSchema.parse({
      ...state,
      semantics: { ...state.semantics, optics: ["focal_85mm"] },
    });
    const result = await compileState(desyncedOptics);
    expect(result.warnings).toContainEqual(
      'semantics.optics[0]: "focal_85mm" conflicts with camera.focalLengthMm=50mm; ' +
        "the structured number is authoritative",
    );
  });
});

describe("GenericVideoPromptAdapter config wiring (content/adapters/generic-video.yaml)", () => {
  it("drives the semantics section order from the config ordering", async () => {
    const config = await realAdapterConfig();
    const reordered: VideoPromptAdapterConfig = {
      ...config,
      ordering: ["motion", "continuity", "subjects", "composition", "optics"],
    };
    const adapter = new GenericVideoPromptAdapter(reordered);
    const result = await adapter.compile(
      normalizeShotState(await stateFromTemplate("dialogue_ots_a_to_b")),
    );
    const lines = result.prompt.split("\n");
    const indexOf = (prefix: string) => lines.findIndex((line) => line.startsWith(`${prefix}:`));
    expect(indexOf("motion")).toBeLessThan(indexOf("continuity"));
    expect(indexOf("continuity")).toBeLessThan(indexOf("subjects"));
    expect(indexOf("subjects")).toBeLessThan(indexOf("composition"));
    expect(indexOf("composition")).toBeLessThan(indexOf("optics"));
  });

  it("renders the protected-facts line from the config constraints", async () => {
    const result = await compileState(await stateFromTemplate("dialogue_ots_a_to_b"));
    expect(result.prompt).toContain(
      "protected-facts (must survive any later polish): character_identity, character_position, " +
        "camera_geometry, focal_length, movement_type, continuity_rules",
    );
  });

  it("omits the polish warning when the config disallows LLM polish", async () => {
    const config = await realAdapterConfig();
    const adapter = new GenericVideoPromptAdapter({
      ...config,
      constraints: { ...config.constraints, allowLlmPolish: false },
    });
    const result = await adapter.compile(
      normalizeShotState(await stateFromTemplate("dialogue_medium_two_shot")),
    );
    expect(result.warnings.join("\n")).not.toContain("allowLlmPolish");
  });

  it("refuses a config that lets semantics override structured facts", async () => {
    const config = await realAdapterConfig();
    expect(
      () =>
        new GenericVideoPromptAdapter({
          ...config,
          constraints: { ...config.constraints, preserveStructuredFacts: false },
        }),
    ).toThrowError(/preserveStructuredFacts/);
  });

  it("refuses a config authored for a different adapter id", async () => {
    const config = await realAdapterConfig();
    expect(() => new GenericVideoPromptAdapter({ ...config, id: "some_provider" })).toThrowError(
      /generic_video/,
    );
  });
});

describe("compileVideoPrompt entry", () => {
  it("runs state -> normalization -> adapter end-to-end and matches the golden prompt", async () => {
    const state = await stateFromTemplate(
      "dialogue_ots_b_to_a",
      GOLDEN_IDS["dialogue_ots_b_to_a"]!,
    );
    const adapter = await realAdapter();
    const result = await compileVideoPrompt(state, adapter);
    expect(result.prompt).toBe(await readGoldenPrompt("dialogue_ots_b_to_a"));
    expect(result.source.shotStateId).toBe(GOLDEN_IDS["dialogue_ots_b_to_a"]!);
  });

  it("rejects a schema-invalid ShotState before any compilation", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b");
    const invalid = { ...state, camera: { ...state.camera, focalLengthMm: 250 } };
    const adapter = await realAdapter();
    await expect(compileVideoPrompt(invalid as ShotState, adapter)).rejects.toThrowError(
      /focalLengthMm/,
    );
  });

  it("does not mutate the canonical state", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b");
    const before = structuredClone(state);
    await compileVideoPrompt(state, await realAdapter());
    expect(state).toEqual(before);
  });
});

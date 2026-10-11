import { describe, expect, it } from "vitest";

import { GenericVideoPromptAdapter } from "../../src/adapters/video-prompts/generic";
import { SeedanceVideoPromptAdapter } from "../../src/adapters/video-prompts/seedance";
import { fullExportManifestSchema, sha256Hex } from "../../src/domain/artifacts";
import {
  createShotStateFromTemplate,
  shotStateFingerprint,
  type ShotState,
} from "../../src/domain/shot-state";
import { compileVideoPrompt } from "../../src/features/prompt-compiler/compile";
import {
  buildFullExportPackage,
  fullExportFileName,
  type FullExportEnhancedFrame,
} from "../../src/features/export-package/full-export-package";
import {
  buildTemplateDiff,
  TEMPLATE_DIFF_NO_DEVIATIONS,
} from "../../src/features/export-package/template-diff";
import { readStoreZip } from "../helpers/zip-reader";
import { loadRealContent } from "../helpers/content-test-utils";

/**
 * Full input-package assembly (Prompt 8 / Phase 2 §2.3). Every test builds
 * REAL prompts through both adapters from the SAME frozen state, so the
 * same-source verification is exercised against genuine compiled artifacts,
 * not hand-built fakes. Zero network, zero cost.
 */

const FIXED_ID = "shot-prompt8-full";

async function realAdapters() {
  const { adapterConfigs } = await loadRealContent();
  const generic = adapterConfigs.find((c) => c.id === "generic_video");
  const target = adapterConfigs.find((c) => c.id === "seedance_video");
  if (generic === undefined || target === undefined) {
    throw new Error("adapter configs missing");
  }
  return {
    generic: new GenericVideoPromptAdapter(generic),
    target: new SeedanceVideoPromptAdapter(target),
  };
}

async function otsTemplate() {
  const { templates } = await loadRealContent();
  const template = templates.find((t) => t.id === "dialogue_ots_a_to_b")!;
  return template;
}

async function frozenState(): Promise<ShotState> {
  return createShotStateFromTemplate(await otsTemplate(), { generateId: () => FIXED_ID });
}

async function compilePrompts(state: ShotState) {
  const adapters = await realAdapters();
  return {
    generic: await compileVideoPrompt(state, adapters.generic),
    target: await compileVideoPrompt(state, adapters.target),
  };
}

function images(): {
  compositionRaw: Uint8Array;
  movementStart: Uint8Array;
  movementEnd: Uint8Array;
} {
  return {
    compositionRaw: new Uint8Array([1, 2, 3]),
    movementStart: new Uint8Array([4, 5]),
    movementEnd: new Uint8Array([6]),
  };
}

function enhancedFrom(state: ShotState): FullExportEnhancedFrame {
  return {
    bytes: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
    mimeType: "image/svg+xml",
    adapterId: "mock-image-generation",
    adapterVersion: "1.0.0",
    provider: "mock",
    sourceFingerprint: shotStateFingerprint(state),
  };
}

const GENERATED_AT = new Date("2026-10-08T12:00:00.000Z");

describe("buildFullExportPackage happy paths", () => {
  it("bundles eight files plus the enhanced frame and a schema-valid v3 manifest", async () => {
    const state = await frozenState();
    const pkg = await buildFullExportPackage({
      shotState: state,
      template: await otsTemplate(),
      images: images(),
      prompts: await compilePrompts(state),
      enhancedFrame: enhancedFrom(state),
      generatedAt: GENERATED_AT,
    });

    expect(pkg.fileName).toBe(fullExportFileName(FIXED_ID));
    expect(pkg.manifest.kind).toBe("storyboard-director-full-export");
    expect(pkg.manifest.manifestVersion).toBe(3);
    expect(pkg.manifest.enhancedFrame).toMatchObject({
      included: true,
      fileName: "enhanced-first-frame.svg",
      provider: "mock",
    });
    expect(pkg.manifest.prompts.generic).toMatchObject({
      fileName: "prompt-generic.txt",
      adapterId: "generic_video",
    });
    expect(pkg.manifest.prompts.target).toMatchObject({
      fileName: "prompt-seedance.txt",
      adapterId: "seedance_video",
    });
    expect(pkg.manifest.files.map((f) => f.name).sort()).toEqual(
      [
        "composition-raw.png",
        "enhanced-first-frame.svg",
        "movement-end.png",
        "movement-start.png",
        "prompt-generic.txt",
        "prompt-seedance.txt",
        "shot-state.json",
        "template-diff.txt",
      ].sort(),
    );

    // The manifest re-validates against its own executable schema.
    expect(fullExportManifestSchema.parse(pkg.manifest)).toEqual(pkg.manifest);

    // The real archive re-parses; every hashed entry matches its bytes.
    const entries = new Map(
      readStoreZip(Buffer.from(pkg.zip)).map((entry) => [entry.name, entry.data]),
    );
    expect([...entries.keys()].sort()).toEqual(
      [
        "composition-raw.png",
        "enhanced-first-frame.svg",
        "manifest.json",
        "movement-end.png",
        "movement-start.png",
        "prompt-generic.txt",
        "prompt-seedance.txt",
        "shot-state.json",
        "template-diff.txt",
      ].sort(),
    );
    for (const file of pkg.manifest.files) {
      const bytes = entries.get(file.name)!;
      expect(bytes.byteLength).toBe(file.bytes);
      expect(await sha256Hex(bytes)).toBe(file.sha256);
    }
    // The prompt files are the exact adapter outputs for THIS state.
    const prompts = await compilePrompts(state);
    expect(new TextDecoder().decode(entries.get("prompt-generic.txt")!)).toBe(
      prompts.generic.prompt,
    );
    expect(new TextDecoder().decode(entries.get("prompt-seedance.txt")!)).toBe(
      prompts.target.prompt,
    );
    // An unedited state ships the explicit no-deviations marker.
    expect(new TextDecoder().decode(entries.get("template-diff.txt")!)).toBe(
      [
        "template-diff: field-level deviations from the template defaults",
        `source: shot-state=${FIXED_ID} template=dialogue_ots_a_to_b@v3 review-status=approved`,
        TEMPLATE_DIFF_NO_DEVIATIONS,
      ].join("\n"),
    );
  });

  it("an edited state ships its field-level deviations in template-diff.txt", async () => {
    const state = await frozenState();
    const edited = JSON.parse(JSON.stringify(state)) as ShotState;
    edited.camera = { ...edited.camera, focalLengthMm: 85 };
    edited.characters = edited.characters.map((c) =>
      c.id === "character_b" ? { ...c, position: [0.6, 0, 0.2] } : c,
    );
    const pkg = await buildFullExportPackage({
      shotState: edited,
      template: await otsTemplate(),
      images: images(),
      prompts: await compilePrompts(edited),
      enhancedFrame: { reason: "absent" },
      generatedAt: GENERATED_AT,
    });
    const entries = new Map(
      readStoreZip(Buffer.from(pkg.zip)).map((entry) => [entry.name, entry.data]),
    );
    const diff = new TextDecoder().decode(entries.get("template-diff.txt")!);
    expect(diff).toContain("camera.focalLengthMm: 75 -> 85");
    expect(diff).toContain("characters.character_b.position: [0.8,0,0] -> [0.6,0,0.2]");
    // Untouched fields do not appear.
    expect(diff).not.toContain("camera.position");
    expect(diff).not.toContain("movement.");
    expect(diff).not.toContain("semantics.");
    expect(diff).not.toContain(TEMPLATE_DIFF_NO_DEVIATIONS);
  });

  it("records absent/stale enhanced frames instead of shipping them", async () => {
    const state = await frozenState();
    const prompts = await compilePrompts(state);

    const absent = await buildFullExportPackage({
      shotState: state,
      template: await otsTemplate(),
      images: images(),
      prompts,
      enhancedFrame: { reason: "absent" },
      generatedAt: GENERATED_AT,
    });
    expect(absent.manifest.enhancedFrame).toEqual({ included: false, reason: "absent" });
    expect(absent.manifest.files.map((f) => f.name).includes("enhanced-first-frame.svg")).toBe(
      false,
    );

    // A fingerprint that no longer matches the frozen state (simulated edit):
    // the builder excludes the frame deterministically as "stale".
    const staleOffer = enhancedFrom(state);
    const edited = JSON.parse(JSON.stringify(state)) as ShotState;
    edited.camera = { ...edited.camera, focalLengthMm: 85 };
    const stale = await buildFullExportPackage({
      shotState: state,
      template: await otsTemplate(),
      images: images(),
      prompts,
      enhancedFrame: { ...staleOffer, sourceFingerprint: shotStateFingerprint(edited) },
      generatedAt: GENERATED_AT,
    });
    expect(stale.manifest.enhancedFrame).toEqual({ included: false, reason: "stale" });
  });

  it("is byte-deterministic for one snapshot + one timestamp", async () => {
    const state = await frozenState();
    const prompts = await compilePrompts(state);
    const first = await buildFullExportPackage({
      shotState: state,
      template: await otsTemplate(),
      images: images(),
      prompts,
      enhancedFrame: enhancedFrom(state),
      generatedAt: GENERATED_AT,
    });
    const second = await buildFullExportPackage({
      shotState: state,
      template: await otsTemplate(),
      images: images(),
      prompts: await compilePrompts(state),
      enhancedFrame: enhancedFrom(state),
      generatedAt: GENERATED_AT,
    });
    expect(second.zip).toEqual(first.zip);
    expect(second.manifest).toEqual(first.manifest);
  });
});

describe("buildFullExportPackage same-source verification", () => {
  it("REFUSES the package when the generic prompt was compiled from another state", async () => {
    const state = await frozenState();
    const other = await frozenState();
    const otherStateId = { ...other, id: "shot-prompt8-other" } as ShotState;
    const wrongPrompts = await compilePrompts(otherStateId);
    await expect(
      buildFullExportPackage({
        shotState: state,
        template: await otsTemplate(),
        images: images(),
        prompts: wrongPrompts,
        enhancedFrame: { reason: "absent" },
        generatedAt: GENERATED_AT,
      }),
    ).rejects.toThrow(/generic prompt was not compiled from this frozen ShotState/);
  });

  it("REFUSES the package when the target prompt's template version differs", async () => {
    const state = await frozenState();
    const prompts = await compilePrompts(state);
    const mismatchedTemplate = {
      ...prompts,
      target: {
        ...prompts.target,
        source: { ...prompts.target.source, templateVersion: 99 },
      },
    };
    await expect(
      buildFullExportPackage({
        shotState: state,
        template: await otsTemplate(),
        images: images(),
        prompts: mismatchedTemplate,
        enhancedFrame: { reason: "absent" },
        generatedAt: GENERATED_AT,
      }),
    ).rejects.toThrow(/target prompt was not compiled from this frozen ShotState/);
  });

  it("REFUSES the package when the diff baseline template does not match the state", async () => {
    const state = await frozenState();
    const prompts = await compilePrompts(state);
    const wrongBaseline = { ...(await otsTemplate()), version: 99 };
    await expect(
      buildFullExportPackage({
        shotState: state,
        template: wrongBaseline,
        images: images(),
        prompts,
        enhancedFrame: { reason: "absent" },
        generatedAt: GENERATED_AT,
      }),
    ).rejects.toThrow(/template-diff refused/);
  });
});

describe("buildTemplateDiff (the v3 diff artifact)", () => {
  it("refuses a baseline that does not match the state's template id@version", async () => {
    const state = await frozenState();
    const wrongVersion = { ...(await otsTemplate()), version: 99 };
    expect(() => buildTemplateDiff(state, wrongVersion)).toThrow(/template-diff refused/);
  });

  it("lists aspect-ratio, movement and semantics deviations with stable paths", async () => {
    const state = JSON.parse(JSON.stringify(await frozenState())) as ShotState;
    state.aspectRatio = "9:16";
    state.movement = { ...state.movement, durationSeconds: 6 };
    state.semantics = { ...state.semantics, optics: ["medium_close_up", "focal_85mm"] };
    const diff = buildTemplateDiff(state, await otsTemplate());
    expect(diff).toContain('aspectRatio: "16:9" -> "9:16"');
    expect(diff).toContain("movement.durationSeconds: 4 -> 6");
    expect(diff).toContain(
      'semantics.optics: ["medium_close_up","focal_75mm","soft_foreground"] -> ["medium_close_up","focal_85mm"]',
    );
    expect(diff).not.toContain(TEMPLATE_DIFF_NO_DEVIATIONS);
  });
});

describe("enhancedFirstFrameFileName", () => {
  it("maps the documented mime types and refuses anything else", async () => {
    const { enhancedFirstFrameFileName } = await import("../../src/domain/artifacts");
    expect(enhancedFirstFrameFileName("image/png")).toBe("enhanced-first-frame.png");
    expect(enhancedFirstFrameFileName("image/svg+xml")).toBe("enhanced-first-frame.svg");
    expect(enhancedFirstFrameFileName("image/jpeg")).toBe("enhanced-first-frame.jpeg");
    expect(enhancedFirstFrameFileName("image/webp")).toBe("enhanced-first-frame.webp");
    expect(() => enhancedFirstFrameFileName("image/tiff")).toThrow(/mime type/);
  });
});

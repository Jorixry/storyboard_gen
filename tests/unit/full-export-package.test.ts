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

async function frozenState(): Promise<ShotState> {
  const { templates } = await loadRealContent();
  const template = templates.find((t) => t.id === "dialogue_ots_a_to_b")!;
  return createShotStateFromTemplate(template, { generateId: () => FIXED_ID });
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
  it("bundles seven files plus the enhanced frame and a schema-valid v2 manifest", async () => {
    const state = await frozenState();
    const pkg = await buildFullExportPackage({
      shotState: state,
      images: images(),
      prompts: await compilePrompts(state),
      enhancedFrame: enhancedFrom(state),
      generatedAt: GENERATED_AT,
    });

    expect(pkg.fileName).toBe(fullExportFileName(FIXED_ID));
    expect(pkg.manifest.kind).toBe("storyboard-director-full-export");
    expect(pkg.manifest.manifestVersion).toBe(2);
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
  });

  it("records absent/stale enhanced frames instead of shipping them", async () => {
    const state = await frozenState();
    const prompts = await compilePrompts(state);

    const absent = await buildFullExportPackage({
      shotState: state,
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
      images: images(),
      prompts,
      enhancedFrame: enhancedFrom(state),
      generatedAt: GENERATED_AT,
    });
    const second = await buildFullExportPackage({
      shotState: state,
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
        images: images(),
        prompts: mismatchedTemplate,
        enhancedFrame: { reason: "absent" },
        generatedAt: GENERATED_AT,
      }),
    ).rejects.toThrow(/target prompt was not compiled from this frozen ShotState/);
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

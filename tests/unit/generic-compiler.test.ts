import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import type { ShotState } from "@/domain/shot-state";
import { normalizeShotState, type NormalizedShotSpec } from "@/domain/normalized-spec";
import { createSequenceIdFactory } from "@/domain/ids";
import { createShotStateFromTemplate } from "@/domain/shot-state";
import {
  compileGenericPrompt,
  GENERIC_PROMPT_ADAPTER_ID,
  GENERIC_PROMPT_ADAPTER_VERSION,
  GENERIC_SECTION_ORDERING,
} from "@/features/prompt-compiler/generic-compiler";

import { loadRealTemplates, realContentDir } from "../helpers/content-test-utils";

async function loadNormalized(templateId: string): Promise<NormalizedShotSpec> {
  const templates = await loadRealTemplates();
  const template = templates.find((candidate) => candidate.id === templateId);
  if (template === undefined) {
    throw new Error(`${templateId} not found in real content`);
  }
  const state: ShotState = createShotStateFromTemplate(template, {
    generateId: createSequenceIdFactory("shot"),
  });
  return normalizeShotState(state);
}

describe("compileGenericPrompt", () => {
  it("snapshots the generic prompt for each real template", async () => {
    for (const templateId of [
      "dialogue_medium_two_shot",
      "dialogue_ots_a_to_b",
      "dialogue_ots_b_to_a",
    ]) {
      const compiled = compileGenericPrompt(await loadNormalized(templateId));
      expect(compiled.adapterId).toBe(GENERIC_PROMPT_ADAPTER_ID);
      expect(compiled.adapterVersion).toBe(GENERIC_PROMPT_ADAPTER_VERSION);
      expect(compiled.warnings).toEqual([]);
      expect(compiled.prompt).toMatchSnapshot(templateId);
    }
  });

  it("is deterministic: identical input compiles to identical output", async () => {
    const spec = await loadNormalized("dialogue_ots_a_to_b");
    expect(compileGenericPrompt(spec)).toEqual(compileGenericPrompt(spec));
  });

  it("keeps the section ordering in sync with content/adapters/generic-video.yaml", async () => {
    const yamlText = await readFile(
      path.join(realContentDir, "adapters", "generic-video.yaml"),
      "utf8",
    );
    const adapter = parseYaml(yamlText) as { id: string; version: number; ordering: string[] };
    expect(adapter.id).toBe(GENERIC_PROMPT_ADAPTER_ID);
    expect(String(adapter.version)).toBe(GENERIC_PROMPT_ADAPTER_VERSION);
    expect(adapter.ordering).toEqual([...GENERIC_SECTION_ORDERING]);
  });

  it("renders sections in the adapter ordering", async () => {
    const { prompt } = compileGenericPrompt(await loadNormalized("dialogue_ots_a_to_b"));
    const positions = GENERIC_SECTION_ORDERING.map((section) => prompt.indexOf(`${section}: `));
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("keeps every semantics token verbatim and every geometric fact exact", async () => {
    const spec = await loadNormalized("dialogue_ots_b_to_a");
    const { prompt } = compileGenericPrompt(spec);
    for (const field of GENERIC_SECTION_ORDERING) {
      for (const token of spec.semantics[field]) {
        expect(prompt).toContain(token);
      }
    }
    expect(prompt).toContain(`focal length: ${spec.focalLengthMm.toFixed(1)}mm`);
    expect(prompt).toContain(`aspect ratio: ${spec.aspectRatio}`);
    expect(prompt).toContain(`shot size: ${spec.shotSize}`);
    expect(prompt).toContain(`primary subject: ${spec.primarySubject}`);
    expect(prompt).toContain(
      `movement: ${spec.movementType}, ${spec.movementDurationSeconds.toFixed(1)}s, ${spec.movementEasing}`,
    );
    expect(prompt).toContain(`template: ${spec.templateId}@v${spec.templateVersion}`);
  });

  it("warns when an optics focal token contradicts the canonical focal length", async () => {
    const spec = await loadNormalized("dialogue_ots_a_to_b");
    const stale: NormalizedShotSpec = {
      ...spec,
      focalLengthMm: 85,
      semantics: { ...spec.semantics, optics: [...spec.semantics.optics] },
    };
    const { warnings } = compileGenericPrompt(stale);
    expect(warnings).toEqual([
      `optics token "focal_75mm" contradicts canonical focal length 85.0mm`,
    ]);
  });

  it("warns when the motion tokens contradict the movement type", async () => {
    const spec = await loadNormalized("dialogue_ots_a_to_b");
    const staticState: NormalizedShotSpec = {
      ...spec,
      movementType: "static",
    };
    expect(compileGenericPrompt(staticState).warnings).toContain(
      `motion token "subtle_dolly_in" contradicts movement type "static"`,
    );

    const twoShot = await loadNormalized("dialogue_medium_two_shot");
    const moving: NormalizedShotSpec = { ...twoShot, movementType: "dolly_out" };
    expect(compileGenericPrompt(moving).warnings).toContain(
      `motion token "static_camera" contradicts movement type "dolly_out"`,
    );
  });
});

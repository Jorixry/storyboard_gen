import { describe, expect, it } from "vitest";

import {
  normalizeShotState,
  normalizedShotSpecSchema,
} from "../../src/domain/prompt-normalization";
import {
  createShotStateFromTemplate,
  SHOT_STATE_SCHEMA_VERSION,
  shotStateSchema,
  type ShotState,
} from "../../src/domain/shot-state";
import { loadRealTemplates } from "../helpers/content-test-utils";

/**
 * Normalization (Prompt 6): canonical ShotState -> NormalizedShotSpec.
 * Invariants under test: the schema gate rejects invalid input outright, every
 * structured fact survives, the input is never mutated, and the output is
 * deterministic with a canonical character order.
 */

const FIXED_ID = "normalization-test-shot";

async function stateFromTemplate(templateId: string): Promise<ShotState> {
  const template = (await loadRealTemplates()).find((t) => t.id === templateId);
  if (template === undefined) {
    throw new Error(`template ${templateId} not found`);
  }
  return createShotStateFromTemplate(template, { generateId: () => FIXED_ID });
}

describe("normalizeShotState", () => {
  it("preserves every structured fact for all three development templates", async () => {
    for (const templateId of [
      "dialogue_medium_two_shot",
      "dialogue_ots_a_to_b",
      "dialogue_ots_b_to_a",
    ]) {
      const state = await stateFromTemplate(templateId);
      const spec = normalizeShotState(state);

      expect(spec.state).toEqual({ id: FIXED_ID, schemaVersion: SHOT_STATE_SCHEMA_VERSION });
      expect(spec.template).toEqual({
        id: state.template.id,
        version: state.template.version,
        reviewStatus: state.template.reviewStatus,
      });
      expect(spec.scene).toEqual({ presetId: "dialogue_room" });
      expect(spec.aspectRatio).toBe(state.aspectRatio);
      expect(spec.camera).toEqual({
        position: state.camera.position,
        target: state.camera.target,
        focalLengthMm: state.camera.focalLengthMm,
        shotSize: state.camera.shotSize,
      });
      expect(spec.characters).toEqual([
        {
          id: "character_a",
          position: state.characters[0]!.position,
          rotationYDeg: state.characters[0]!.rotationYDeg,
        },
        {
          id: "character_b",
          position: state.characters[1]!.position,
          rotationYDeg: state.characters[1]!.rotationYDeg,
        },
      ]);
      expect(spec.movement).toEqual(state.movement);
      expect(spec.semantics).toEqual(state.semantics);
    }
  });

  it("keeps the CURRENT camera pose separate from the movement start/end poses", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b");
    // Simulate an edited current pose that diverges from both movement poses.
    const edited: ShotState = shotStateSchema.parse({
      ...state,
      camera: { ...state.camera, position: [0, 1.5, 3] as [number, number, number] },
    });
    const spec = normalizeShotState(edited);
    expect(spec.camera.position).toEqual([0, 1.5, 3]);
    expect(spec.movement.start.position).toEqual(state.movement.start.position);
    expect(spec.movement.end.position).toEqual(state.movement.end.position);
  });

  it("rejects schema-invalid input without producing a partial specification", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b");

    const outOfRangeFocal = { ...state, camera: { ...state.camera, focalLengthMm: 250 } };
    expect(() => normalizeShotState(outOfRangeFocal as ShotState)).toThrowError(/focalLengthMm/);

    const missingCharacter = {
      ...state,
      characters: [state.characters[0]!],
    };
    expect(() => normalizeShotState(missingCharacter as unknown as ShotState)).toThrowError(
      /character_b/,
    );

    const unknownField = { ...state, extra: "no" };
    expect(() => normalizeShotState(unknownField as unknown as ShotState)).toThrowError(
      /extra|Unrecognized key/,
    );
  });

  it("does not mutate the input state (nested arrays included)", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b");
    const before = structuredClone(state);
    const spec = normalizeShotState(state);
    expect(state).toEqual(before);

    // The spec must also share no mutable references with the state.
    spec.camera.position[0] = 999;
    spec.semantics.optics.push("focal_999mm");
    expect(state.camera.position[0]).toBe(before.camera.position[0]);
    expect(state.semantics.optics).toEqual(before.semantics.optics);
  });

  it("emits characters in canonical order regardless of input array order", async () => {
    const state = await stateFromTemplate("dialogue_ots_a_to_b");
    const reversed: ShotState = shotStateSchema.parse({
      ...state,
      characters: [state.characters[1]!, state.characters[0]!],
    });
    const spec = normalizeShotState(reversed);
    expect(spec.characters.map((character) => character.id)).toEqual([
      "character_a",
      "character_b",
    ]);
    expect(spec).toEqual(normalizeShotState(state));
  });

  it("is deterministic for repeated normalization of the same state", async () => {
    const state = await stateFromTemplate("dialogue_ots_b_to_a");
    expect(normalizeShotState(state)).toEqual(normalizeShotState(state));
  });

  it("normalizedShotSpecSchema is strict: unknown spec fields are rejected", async () => {
    const spec = normalizeShotState(await stateFromTemplate("dialogue_medium_two_shot"));
    const withExtra = { ...spec, surprise: true };
    expect(() => normalizedShotSpecSchema.parse(withExtra)).toThrowError(
      /surprise|Unrecognized key/,
    );
  });
});

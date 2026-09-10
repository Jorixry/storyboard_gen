import { describe, expect, it } from "vitest";

import type { ShotState } from "@/domain/shot-state";
import {
  normalizeShotState,
  PRIMARY_SUBJECT_BY_TOKEN,
  SEMANTIC_TOKEN_FIELDS,
} from "@/domain/normalized-spec";
import { createSequenceIdFactory } from "@/domain/ids";
import { createShotStateFromTemplate } from "@/domain/shot-state";
import { syncFocalSemantics, syncPrimarySubjectSemantics } from "@/domain/semantic-sync";

import { loadRealTemplates } from "../helpers/content-test-utils";

async function loadState(templateId: string): Promise<ShotState> {
  const templates = await loadRealTemplates();
  const template = templates.find((candidate) => candidate.id === templateId);
  if (template === undefined) {
    throw new Error(`${templateId} not found in real content`);
  }
  return createShotStateFromTemplate(template, { generateId: createSequenceIdFactory("shot") });
}

describe("normalizeShotState", () => {
  it("snapshots the normalized specification for each real template", async () => {
    const states = await Promise.all([
      loadState("dialogue_medium_two_shot"),
      loadState("dialogue_ots_a_to_b"),
      loadState("dialogue_ots_b_to_a"),
    ]);
    for (const state of states) {
      expect(normalizeShotState(state)).toMatchSnapshot(state.template.id);
    }
  });

  it("is deterministic: equal states normalize to deeply equal specs", async () => {
    const state = await loadState("dialogue_ots_a_to_b");
    expect(normalizeShotState(state)).toEqual(normalizeShotState(state));
  });

  it("preserves every geometric fact exactly (camera, characters, focal)", async () => {
    const state = await loadState("dialogue_ots_a_to_b");
    const spec = normalizeShotState(state);
    expect(spec.geometry.camera.position).toEqual(state.camera.position);
    expect(spec.geometry.camera.target).toEqual(state.camera.target);
    expect(spec.geometry.camera.focalLengthMm).toBe(state.camera.focalLengthMm);
    expect(spec.focalLengthMm).toBe(state.camera.focalLengthMm);
    expect(spec.geometry.characters).toEqual(state.characters);
  });

  it("passes the five semantics groups through verbatim without sharing references", async () => {
    const state = await loadState("dialogue_medium_two_shot");
    const spec = normalizeShotState(state);
    expect(SEMANTIC_TOKEN_FIELDS).toEqual([
      "subjects",
      "composition",
      "optics",
      "motion",
      "continuity",
    ]);
    for (const field of SEMANTIC_TOKEN_FIELDS) {
      expect(spec.semantics[field]).toEqual(state.semantics[field]);
      expect(spec.semantics[field]).not.toBe(state.semantics[field]);
    }
    expect(spec.continuityRuleIds).toEqual(state.semantics.continuity);
  });

  it("derives primary subject from the shipped token family", async () => {
    const aToB = normalizeShotState(await loadState("dialogue_ots_a_to_b"));
    const bToA = normalizeShotState(await loadState("dialogue_ots_b_to_a"));
    const twoShot = normalizeShotState(await loadState("dialogue_medium_two_shot"));
    expect(PRIMARY_SUBJECT_BY_TOKEN["character_b_primary"]).toBe(aToB.primarySubject);
    expect(PRIMARY_SUBJECT_BY_TOKEN["character_a_primary"]).toBe(bToA.primarySubject);
    expect(twoShot.primarySubject).toBe(
      PRIMARY_SUBJECT_BY_TOKEN["character_a_and_character_b_equal_prominence"],
    );
  });

  it("falls back to target proximity when no primary-subject token exists", async () => {
    const state = await loadState("dialogue_ots_a_to_b");
    // OTS A-to-B targets character B: removing the tokens must still resolve B.
    const stripped: ShotState = {
      ...state,
      semantics: {
        ...state.semantics,
        subjects: state.semantics.subjects.filter((token) => !(token in PRIMARY_SUBJECT_BY_TOKEN)),
      },
    };
    expect(normalizeShotState(stripped).primarySubject).toBe("character_b");
  });

  it("stays consistent with semantic-sync after an emphasize edit", async () => {
    const state = await loadState("dialogue_ots_a_to_b");
    const edited: ShotState = {
      ...state,
      semantics: syncPrimarySubjectSemantics(state.semantics, "character_a"),
    };
    expect(normalizeShotState(edited).primarySubject).toBe("character_a");
  });

  it("stays consistent with semantic-sync after a focal edit", async () => {
    const state = await loadState("dialogue_ots_a_to_b");
    const edited: ShotState = {
      ...state,
      camera: { ...state.camera, focalLengthMm: 85 },
      movement: { ...state.movement },
      semantics: syncFocalSemantics(state.semantics, 85),
    };
    const spec = normalizeShotState(edited);
    expect(spec.focalLengthMm).toBe(85);
    expect(spec.semantics.optics).toContain("focal_85mm");
    expect(spec.semantics.optics).not.toContain("focal_75mm");
  });

  it("reports camera-to-character distances from the canonical camera", async () => {
    const state = await loadState("dialogue_ots_a_to_b");
    const spec = normalizeShotState(state);
    // Camera at [-1.25, 1.7, 2]; A at [-0.8, 0, 0], B at [0.8, 0, 0].
    expect(spec.geometry.cameraToCharacterDistanceM.character_a).toBeCloseTo(
      Math.hypot(-1.25 + 0.8, 1.7, 2),
      10,
    );
    expect(spec.geometry.cameraToCharacterDistanceM.character_b).toBeCloseTo(
      Math.hypot(-1.25 - 0.8, 1.7, 2),
      10,
    );
  });
});

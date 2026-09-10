/**
 * Normalized shot specification — the model-independent input contract of
 * every VideoPromptAdapter (Prompt 6 / Phase 2 §2.1).
 *
 * Data flow (docs/ARCHITECTURE.md "Prompt compiler"):
 *   schema-validated ShotState -> NormalizedShotSpec -> VideoPromptAdapter
 *   -> prompt + warnings + adapter/source metadata
 *
 * This Zod schema is the SINGLE definition of the normalized shape: the
 * TypeScript type is inferred from it, and the adapter boundary
 * (src/adapters/video-prompts/types.ts) re-exports that type instead of
 * maintaining a second copy.
 *
 * Normalization policy (framework-independent; no React/Three.js/browser):
 * - the input must pass the canonical `shotStateSchema` first; invalid input
 *   throws and NEVER yields a partial specification;
 * - the CURRENT camera pose and the movement start/end poses are carried as
 *   separate facts (they are not merged into one pose);
 * - the output shares no mutable reference with the input state, template or
 *   store (arrays are copied; the input is never mutated);
 * - characters are emitted in the canonical order character_a then
 *   character_b, so two schema-valid states that differ only in array order
 *   normalize to the identical specification;
 * - `camera.safeRanges` is deliberately not carried: it is editing guidance
 *   derived from the content Schema bounds, not a fact a prompt needs.
 */
import { z } from "zod";

import {
  aspectRatioSchema,
  charactersSchema,
  focalLengthSchema,
  movementStateSchema,
  promptSemanticsSchema,
  scenePresetIdSchema,
  shotSizeSchema,
  vec3Schema,
  type CharacterId,
  type PromptSemantics,
  type Vec3,
} from "./schemas";
import { reviewStatusSchema, templateIdSchema } from "./shot-template";
import { shotStateSchema, type ShotState } from "./shot-state";

export const normalizedShotSpecSchema = z.strictObject({
  state: z.strictObject({
    id: z.string().min(1),
    schemaVersion: z.number().int().min(1),
  }),
  template: z.strictObject({
    id: templateIdSchema,
    version: z.number().int().min(1),
    reviewStatus: reviewStatusSchema,
  }),
  scene: z.strictObject({
    presetId: scenePresetIdSchema,
  }),
  aspectRatio: aspectRatioSchema,
  /** The CURRENT working camera pose — distinct from movement start/end. */
  camera: z.strictObject({
    position: vec3Schema,
    target: vec3Schema,
    focalLengthMm: focalLengthSchema,
    shotSize: shotSizeSchema,
  }),
  characters: charactersSchema,
  movement: movementStateSchema,
  semantics: promptSemanticsSchema,
});

export type NormalizedShotSpec = z.infer<typeof normalizedShotSpecSchema>;

const CANONICAL_CHARACTER_ORDER: readonly CharacterId[] = ["character_a", "character_b"];

function copyPose(pose: { position: Vec3; target: Vec3; focalLengthMm: number }): {
  position: Vec3;
  target: Vec3;
  focalLengthMm: number;
} {
  return {
    position: [...pose.position] as Vec3,
    target: [...pose.target] as Vec3,
    focalLengthMm: pose.focalLengthMm,
  };
}

function copySemantics(semantics: PromptSemantics): PromptSemantics {
  return {
    subjects: [...semantics.subjects],
    composition: [...semantics.composition],
    optics: [...semantics.optics],
    motion: [...semantics.motion],
    continuity: [...semantics.continuity],
  };
}

/**
 * Derives the normalized, model-independent specification from one canonical
 * ShotState. Pure: validates, copies and orders; mutates nothing; throws a
 * ZodError for any input that fails the canonical schema.
 */
export function normalizeShotState(state: ShotState): NormalizedShotSpec {
  const validated = shotStateSchema.parse(state);
  const characters = CANONICAL_CHARACTER_ORDER.map((id) => {
    const character = validated.characters.find((candidate) => candidate.id === id);
    if (character === undefined) {
      // Unreachable after shotStateSchema.parse (exactly character_a/b once each).
      throw new Error(`canonical character "${id}" missing after schema validation`);
    }
    return {
      id,
      position: [...character.position] as Vec3,
      rotationYDeg: character.rotationYDeg,
    };
  });
  return normalizedShotSpecSchema.parse({
    state: { id: validated.id, schemaVersion: validated.schemaVersion },
    template: { ...validated.template },
    scene: { presetId: validated.scene.presetId },
    aspectRatio: validated.aspectRatio,
    camera: {
      position: [...validated.camera.position] as Vec3,
      target: [...validated.camera.target] as Vec3,
      focalLengthMm: validated.camera.focalLengthMm,
      shotSize: validated.camera.shotSize,
    },
    characters,
    movement: {
      type: validated.movement.type,
      start: copyPose(validated.movement.start),
      end: copyPose(validated.movement.end),
      durationSeconds: validated.movement.durationSeconds,
      easing: validated.movement.easing,
    },
    semantics: copySemantics(validated.semantics),
  });
}

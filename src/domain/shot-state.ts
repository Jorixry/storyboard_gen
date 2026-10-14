/**
 * Canonical ShotState.
 *
 * The ShotState is the single source of product truth: prompts and images are
 * derived artifacts, never canonical state. Loading a template always creates
 * a fresh ShotState with a new ID; template identity (id, version,
 * reviewStatus) is preserved for traceability.
 */
import { z } from "zod";

import type { ShotStateIdFactory } from "./ids";
import { defaultShotStateIdFactory } from "./ids";
import {
  aspectRatioSchema,
  cameraStateSchema,
  charactersSchema,
  FOCAL_LENGTH_MAX_MM,
  FOCAL_LENGTH_MIN_MM,
  movementStateSchema,
  promptSemanticsSchema,
  sceneStateSchema,
  type CameraPose,
  type PromptSemantics,
  type Vec3,
} from "./schemas";
import { reviewStatusSchema, templateIdSchema, type ShotTemplate } from "./shot-template";

export const SHOT_STATE_SCHEMA_VERSION = 1;

export const shotStateSchema = z.strictObject({
  id: z.string().min(1),
  schemaVersion: z.literal(SHOT_STATE_SCHEMA_VERSION),
  template: z.strictObject({
    id: templateIdSchema,
    version: z.number().int().min(1),
    reviewStatus: reviewStatusSchema,
  }),
  aspectRatio: aspectRatioSchema,
  scene: sceneStateSchema,
  camera: cameraStateSchema,
  characters: charactersSchema,
  movement: movementStateSchema,
  semantics: promptSemanticsSchema,
});

export type ShotState = z.infer<typeof shotStateSchema>;

/**
 * Deterministic canonical-JSON fingerprint of a complete ShotState (acceptance
 * fix round 2026-09-23): object keys are sorted, so two states compare equal
 * exactly when their CONTENT is equal, independent of key insertion order.
 *
 * Purpose: match a generated artifact against the state it was generated
 * from. This deliberately covers every field — not only `id`, because a shot
 * keeps its ID while camera, aspect ratio, characters or movement are edited.
 * The fingerprint is an equality comparator, not a hash or security primitive.
 */
export function shotStateFingerprint(state: ShotState): string {
  return canonicalJson(state);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Canonical character order for CONTENT comparison: character_a then
 * character_b. Prompt normalization emits characters in this order (two
 * states differing only in array order compile to identical prompts), so
 * prompt-source fingerprints are taken over this canonical form — see
 * prompt-normalization's `state.stateFingerprint`.
 */
export function withCanonicalCharacterOrder(state: ShotState): ShotState {
  const ordered = (["character_a", "character_b"] as const).map((id) =>
    state.characters.find((character) => character.id === id),
  );
  if (ordered.some((character) => character === undefined)) {
    // Unreachable after shotStateSchema.parse (exactly character_a/b once each).
    throw new Error("canonical character missing after schema validation");
  }
  return { ...state, characters: ordered as ShotState["characters"] };
}

export interface CreateShotStateOptions {
  /**
   * ID factory override. Tests inject deterministic factories; production
   * uses the locally generated UUIDv4 default (no network, no dependency).
   */
  generateId?: ShotStateIdFactory;
}

function copyPose(pose: CameraPose): CameraPose {
  return {
    position: [...pose.position] as Vec3,
    target: [...pose.target] as Vec3,
    focalLengthMm: pose.focalLengthMm,
  };
}

function copySemantics(semantics: ShotTemplate["promptSemantics"]): PromptSemantics {
  return {
    subjects: [...semantics.subjects],
    composition: [...semantics.composition],
    optics: [...semantics.optics],
    motion: [...semantics.motion],
    continuity: [...semantics.continuity],
  };
}

/**
 * Creates a fresh canonical ShotState from a validated template.
 *
 * - A new ID is generated on every call;
 * - template id/version/reviewStatus are preserved verbatim;
 * - characters are exactly character_a and character_b;
 * - movement start/end, camera, scene and aspect ratio are copied completely
 *   (current OTS templates keep their 75mm focal length per D025);
 * - camera safe ranges are derived from the content Schema bounds;
 * - the returned object shares no mutable references with the template.
 */
export function createShotStateFromTemplate(
  template: ShotTemplate,
  options: CreateShotStateOptions = {},
): ShotState {
  const generateId = options.generateId ?? defaultShotStateIdFactory;
  const candidate = {
    id: generateId(),
    schemaVersion: SHOT_STATE_SCHEMA_VERSION,
    template: {
      id: template.id,
      version: template.version,
      reviewStatus: template.reviewStatus,
    },
    aspectRatio: template.scene.aspectRatio,
    scene: {
      presetId: template.scene.presetId,
    },
    camera: {
      position: [...template.camera.position] as Vec3,
      target: [...template.camera.target] as Vec3,
      focalLengthMm: template.camera.focalLengthMm,
      shotSize: template.camera.shotSize,
      safeRanges: {
        focalLengthMm: [FOCAL_LENGTH_MIN_MM, FOCAL_LENGTH_MAX_MM],
      },
    },
    characters: template.characters.map((character) => ({
      id: character.id,
      position: [...character.position] as Vec3,
      rotationYDeg: character.rotationYDeg,
    })),
    movement: {
      type: template.movement.type,
      start: copyPose(template.movement.start),
      end: copyPose(template.movement.end),
      durationSeconds: template.movement.durationSeconds,
      easing: template.movement.easing,
    },
    semantics: copySemantics(template.promptSemantics),
  };
  return shotStateSchema.parse(candidate);
}

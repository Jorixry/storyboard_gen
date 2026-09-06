/**
 * Framework-independent Zod schemas for the canonical domain primitives.
 *
 * These schemas mirror `content/schema/shot-template.schema.json` (the
 * authoritative strict content Schema) plus the ShotState-only fields from
 * docs/ARCHITECTURE.md. They must stay equivalent to the JSON Schema: the
 * content pipeline validates against both and reports divergence instead of
 * silently rewriting director data.
 *
 * This module must not import React, Next.js, Three.js or any provider SDK.
 */
import { z } from "zod";

/**
 * Focal-length safe range. Mirrors the `minimum`/`maximum` of
 * `cameraPose.focalLengthMm` and `camera.focalLengthMm` in
 * content/schema/shot-template.schema.json; ShotState safe ranges are
 * derived from this single source.
 */
export const FOCAL_LENGTH_MIN_MM = 12;
export const FOCAL_LENGTH_MAX_MM = 200;

/** JSON Schema `type: "number"` accepts JS Infinity, so finite-ness is asserted explicitly. */
const finiteNumber = z.number().finite();

export const vec3Schema = z.tuple([finiteNumber, finiteNumber, finiteNumber]);
export type Vec3 = z.infer<typeof vec3Schema>;

export const aspectRatioSchema = z.enum(["9:16", "16:9"]);
export type AspectRatio = z.infer<typeof aspectRatioSchema>;

export const focalLengthSchema = finiteNumber.min(FOCAL_LENGTH_MIN_MM).max(FOCAL_LENGTH_MAX_MM);

export const shotSizeSchema = z.enum([
  "wide",
  "full",
  "medium_two_shot",
  "medium",
  "medium_close_up",
  "close_up",
  "insert",
]);
export type ShotSize = z.infer<typeof shotSizeSchema>;

export const cameraPoseSchema = z.strictObject({
  position: vec3Schema,
  target: vec3Schema,
  focalLengthMm: focalLengthSchema,
});
export type CameraPose = z.infer<typeof cameraPoseSchema>;

export const cameraSafeRangesSchema = z.strictObject({
  focalLengthMm: z.tuple([finiteNumber, finiteNumber]),
});
export type CameraSafeRanges = z.infer<typeof cameraSafeRangesSchema>;

export const cameraStateSchema = z.strictObject({
  position: vec3Schema,
  target: vec3Schema,
  focalLengthMm: focalLengthSchema,
  shotSize: shotSizeSchema,
  safeRanges: cameraSafeRangesSchema,
});
export type CameraState = z.infer<typeof cameraStateSchema>;

export const characterIdSchema = z.enum(["character_a", "character_b"]);
export type CharacterId = z.infer<typeof characterIdSchema>;

export const characterStateSchema = z.strictObject({
  id: characterIdSchema,
  position: vec3Schema,
  rotationYDeg: finiteNumber.min(-360).max(360),
});
export type CharacterState = z.infer<typeof characterStateSchema>;

/**
 * A shot always contains exactly `character_a` and `character_b`, once each.
 * The JSON Schema cannot express this on the id enum, so both the JSON-Schema
 * pipeline (semantic pass) and this Zod refinement enforce it.
 */
export const charactersSchema = z
  .array(characterStateSchema)
  .length(2)
  .superRefine((characters, ctx) => {
    const ids = characters.map((character) => character.id);
    for (const expected of ["character_a", "character_b"] as const) {
      const count = ids.filter((id) => id === expected).length;
      if (count !== 1) {
        ctx.addIssue({
          code: "custom",
          path: [],
          message:
            count === 0
              ? `characters must contain exactly one "${expected}"; it is missing`
              : `characters must contain exactly one "${expected}"; found ${count} duplicates`,
        });
      }
    }
  });

export const movementTypeSchema = z.enum([
  "static",
  "dolly_in",
  "dolly_out",
  "truck_left",
  "truck_right",
]);
export type MovementType = z.infer<typeof movementTypeSchema>;

export const easingSchema = z.enum(["linear", "ease_in_out"]);
export type Easing = z.infer<typeof easingSchema>;

export const movementStateSchema = z.strictObject({
  type: movementTypeSchema,
  start: cameraPoseSchema,
  end: cameraPoseSchema,
  durationSeconds: finiteNumber.min(0.5).max(20),
  easing: easingSchema,
});
export type MovementState = z.infer<typeof movementStateSchema>;

export const scenePresetIdSchema = z.literal("dialogue_room");
export type ScenePresetId = z.infer<typeof scenePresetIdSchema>;

/** ShotState scene: the aspect ratio lives at the top level of the state. */
export const sceneStateSchema = z.strictObject({
  presetId: scenePresetIdSchema,
});
export type SceneState = z.infer<typeof sceneStateSchema>;

const semanticListSchema = z
  .array(z.string().min(1))
  .refine((items) => new Set(items).size === items.length, {
    message: "semantic lists must not contain duplicate entries",
  });

export const promptSemanticsSchema = z.strictObject({
  subjects: semanticListSchema,
  composition: semanticListSchema,
  optics: semanticListSchema,
  motion: semanticListSchema,
  continuity: semanticListSchema,
});
export type PromptSemantics = z.infer<typeof promptSemanticsSchema>;

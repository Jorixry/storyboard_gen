/**
 * ShotTemplate domain schema — the compiled form of the YAML templates under
 * content/templates/, structurally equivalent to
 * content/schema/shot-template.schema.json.
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
} from "./schemas";

export const reviewStatusSchema = z.enum([
  "draft",
  "engineering_placeholder",
  "engineering_ready",
  "director_review",
  "approved",
  "deprecated",
]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

/** Shared snake_case id pattern from the JSON Schema (`id` and `directorRuleIds` items). */
const snakeCaseIdSchema = z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, {
  message: "ids must be lowercase snake_case segments",
});

export const templateIdSchema = snakeCaseIdSchema;

export const directorRuleIdsSchema = z
  .array(snakeCaseIdSchema)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "directorRuleIds must not contain duplicate entries",
  });

export const templateDisplaySchema = z.strictObject({
  nameZh: z.string().min(1),
  plainDescriptionZh: z.string().min(1),
  narrativePurposeZh: z.string().min(1),
  emotionalEffectsZh: z.array(z.string().min(1)).min(1),
  whenToUseZh: z.string().min(1),
  whenNotToUseZh: z.string().optional(),
  referenceImage: z.string().min(1),
  referenceRightsNote: z.string().min(1),
});
export type TemplateDisplay = z.infer<typeof templateDisplaySchema>;

const finiteNumber = z.number().finite();

export const shotTemplateSchema = z.strictObject({
  id: templateIdSchema,
  version: finiteNumber.int().min(1),
  reviewStatus: reviewStatusSchema,
  display: templateDisplaySchema,
  scene: z.strictObject({
    presetId: scenePresetIdSchema,
    aspectRatio: aspectRatioSchema,
  }),
  characters: charactersSchema,
  camera: z.strictObject({
    position: vec3Schema,
    target: vec3Schema,
    focalLengthMm: focalLengthSchema,
    shotSize: shotSizeSchema,
  }),
  movement: movementStateSchema,
  directorRuleIds: directorRuleIdsSchema,
  promptSemantics: promptSemanticsSchema,
  acceptance: z.array(z.string().min(1)).min(1),
  directorNotes: z.string().optional(),
});

export type ShotTemplate = z.infer<typeof shotTemplateSchema>;

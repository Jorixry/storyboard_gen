/**
 * Provisional engineering constraints for constrained editing (Prompt 4 /
 * Phase 1 Day 4).
 *
 * These are ENGINEERING constraints, not director-approved safe ranges. They
 * are derived from two confirmed sources only:
 *
 * 1. the content Schema bounds (focalLengthMm 12..200, rotationYDeg
 *    -360..360) — see content/schema/shot-template.schema.json;
 * 2. the dialogue_room geometry rendered by the stage (interior 6 x 2.8 x 7 m
 *    centred on x=0 / z=1, see src/features/rendering/stage-projection.ts),
 *    inset by a 0.1 m wall margin.
 *
 * The unit suite cross-checks these constants against the rendering room spec
 * so the two definitions cannot drift apart silently. Computable director
 * safe ranges (axis, eyeline, occupancy) remain open — see
 * docs/OPEN_QUESTIONS.md. No template content was modified to fit these
 * values.
 *
 * Framework-independent by contract: no React/Next/Three.js/provider imports.
 */

/** Linear range helper: [min, max] with min <= max. */
export interface LinearRange {
  readonly min: number;
  readonly max: number;
}

const range = (min: number, max: number): LinearRange => ({ min, max });

/**
 * Camera and camera-target box: the dialogue_room interior (x: -3..3,
 * y: 0..2.8, z: -2.5..4.5) inset by 0.1 m on every side. The target shares
 * the box so an edited target never leaves the room.
 */
export const CAMERA_POSITION_X_RANGE_M = range(-2.9, 2.9);
export const CAMERA_POSITION_Y_RANGE_M = range(0.3, 2.7);
export const CAMERA_POSITION_Z_RANGE_M = range(-2.4, 4.4);
export const CAMERA_TARGET_X_RANGE_M = CAMERA_POSITION_X_RANGE_M;
export const CAMERA_TARGET_Y_RANGE_M = CAMERA_POSITION_Y_RANGE_M;
export const CAMERA_TARGET_Z_RANGE_M = CAMERA_POSITION_Z_RANGE_M;

/**
 * Minimum distance between the camera position and its target. Below this the
 * view direction degenerates (lookAt of a near-zero vector); commands refuse
 * to produce such a pose instead of silently emitting NaN geometry.
 */
export const MIN_CAMERA_TARGET_DISTANCE_M = 0.3;

/** Characters stand on the floor: their position y is pinned to 0. */
export const CHARACTER_POSITION_Y_M = 0;

/** Character footprint box: room interior inset by 0.3 m on x and z. */
export const CHARACTER_POSITION_X_RANGE_M = range(-2.7, 2.7);
export const CHARACTER_POSITION_Z_RANGE_M = range(-2.2, 4.2);

/**
 * Minimum horizontal separation between the two characters (each mannequin
 * base disc is 0.22 m radius; 0.6 m leaves clear air between the bodies).
 */
export const MIN_CHARACTER_SEPARATION_M = 0.6;

/** Character yaw is stored normalized to [-180, 180] (angle wrap, not clamp). */
export const CHARACTER_YAW_RANGE_DEG = range(-180, 180);

/** Focal-length preset feel: provisional ENGINEERING presets, not director rules. */
export const FOCAL_FEEL_PRESETS = {
  wide: 24,
  natural: 35,
  portrait: 50,
  compressed: 85,
} as const;

export type FocalFeelPresetId = keyof typeof FOCAL_FEEL_PRESETS;

/**
 * Fraction of the remaining camera-target distance travelled by one
 * closer/farther step. 0.2 keeps the operation smooth, reversible in feel and
 * geometrically bounded (a closer step can never overshoot the target).
 */
export const CAMERA_DISTANCE_STEP_FRACTION = 0.2;

/**
 * Fraction by which an emphasize command blends the camera target's
 * horizontal components toward the emphasized character's current position.
 */
export const EMPHASIS_BLEND_FRACTION = 0.5;

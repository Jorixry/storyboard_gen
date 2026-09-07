/**
 * Typed, framework-independent semantic and transform commands (Prompt 4 /
 * Phase 1 Day 4).
 *
 * Every command is a pure function `(state, ...args) => ShotState`:
 * - it NEVER mutates the input state (or any nested object);
 * - it updates explicit typed fields only and never touches movement or
 *   template metadata (movement editing arrives Prompt 5);
 * - focal and emphasis edits synchronize their related canonical semantics
 *   tokens (see semantic-sync.ts) so the state never holds contradictory
 *   facts; every other semantic token is preserved verbatim;
 * - it never concatenates prompt strings — prompts are derived artifacts;
 * - it produces no NaN/Infinity and no degenerate camera geometry.
 *
 * Illegal-input policy (consistent across commands, negative-tested):
 * - non-finite numbers (NaN, ±Infinity) are REJECTED with
 *   `InvalidCommandInputError`;
 * - finite out-of-range linear values are CLAMPED to the provisional
 *   engineering constraints (see engineering-constraints.ts);
 * - angles are WRAPPED to [-180, 180];
 * - a clamped result that would degenerate the camera (position-target
 *   distance below the minimum) or overlap the two characters is REJECTED
 *   with a typed error instead of being silently applied.
 *
 * No React, Next.js, Three.js or provider SDK imports are allowed here.
 */
import { createShotStateFromTemplate } from "./shot-state";
import type { ShotState } from "./shot-state";
import type { ShotTemplate } from "./shot-template";
import type { AspectRatio, CharacterId, Vec3 } from "./schemas";
import { FOCAL_LENGTH_MAX_MM, FOCAL_LENGTH_MIN_MM } from "./schemas";
import { aspectRatioSchema } from "./schemas";
import { syncFocalSemantics, syncPrimarySubjectSemantics } from "./semantic-sync";
import {
  CAMERA_DISTANCE_STEP_FRACTION,
  CAMERA_POSITION_X_RANGE_M,
  CAMERA_POSITION_Y_RANGE_M,
  CAMERA_POSITION_Z_RANGE_M,
  CAMERA_TARGET_X_RANGE_M,
  CAMERA_TARGET_Y_RANGE_M,
  CAMERA_TARGET_Z_RANGE_M,
  CHARACTER_POSITION_X_RANGE_M,
  CHARACTER_POSITION_Y_M,
  CHARACTER_POSITION_Z_RANGE_M,
  CHARACTER_YAW_RANGE_DEG,
  EMPHASIS_BLEND_FRACTION,
  FOCAL_FEEL_PRESETS,
  MIN_CAMERA_TARGET_DISTANCE_M,
  MIN_CHARACTER_SEPARATION_M,
  type FocalFeelPresetId,
  type LinearRange,
} from "./engineering-constraints";

export class InvalidCommandInputError extends Error {
  constructor(
    readonly field: string,
    readonly value: unknown,
  ) {
    super(`${field} must be a finite number; got ${String(value)}`);
    this.name = "InvalidCommandInputError";
  }
}

export class DegenerateCameraGeometryError extends Error {
  constructor(
    operation: string,
    readonly distanceM: number,
  ) {
    super(
      `${operation} would place the camera closer than ${MIN_CAMERA_TARGET_DISTANCE_M} m ` +
        `to its target (distance ${distanceM} m); the command was refused`,
    );
    this.name = "DegenerateCameraGeometryError";
  }
}

export class CharacterOverlapError extends Error {
  constructor(
    readonly characterId: CharacterId,
    readonly separationM: number,
  ) {
    super(
      `moving ${characterId} would leave the two characters less than ${MIN_CHARACTER_SEPARATION_M} m ` +
        `apart (separation ${separationM} m); the command was refused`,
    );
    this.name = "CharacterOverlapError";
  }
}

// ---------------------------------------------------------------------------
// Vector helpers (local, allocation-only; no mutation anywhere).
// ---------------------------------------------------------------------------

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];
const lengthOf = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

function assertFinite(field: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new InvalidCommandInputError(field, value);
  }
}

function assertFiniteVec3(field: string, value: Vec3): void {
  value.forEach((component, index) => assertFinite(`${field}[${index}]`, component));
}

function clampToRange(value: number, bounds: LinearRange): number {
  return Math.min(Math.max(value, bounds.min), bounds.max);
}

const CAMERA_BOX = {
  x: CAMERA_POSITION_X_RANGE_M,
  y: CAMERA_POSITION_Y_RANGE_M,
  z: CAMERA_POSITION_Z_RANGE_M,
};

const TARGET_BOX = {
  x: CAMERA_TARGET_X_RANGE_M,
  y: CAMERA_TARGET_Y_RANGE_M,
  z: CAMERA_TARGET_Z_RANGE_M,
};

function clampToBox(vector: Vec3, box: { x: LinearRange; y: LinearRange; z: LinearRange }): Vec3 {
  return [
    clampToRange(vector[0], box.x),
    clampToRange(vector[1], box.y),
    clampToRange(vector[2], box.z),
  ];
}

function horizontalSeparationM(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function findCharacter(state: ShotState, characterId: CharacterId) {
  const character = state.characters.find((candidate) => candidate.id === characterId);
  if (character === undefined) {
    // Unreachable for schema-valid states (exactly character_a/b); defensive.
    throw new InvalidCommandInputError("characterId", Number.NaN);
  }
  return character;
}

function replaceCamera(
  state: ShotState,
  patch: Partial<Pick<ShotState["camera"], "position" | "target" | "focalLengthMm">>,
): ShotState {
  return { ...state, camera: { ...state.camera, ...patch } };
}

function replaceCharacter(
  state: ShotState,
  characterId: CharacterId,
  patch: { position?: Vec3; rotationYDeg?: number },
): ShotState {
  return {
    ...state,
    characters: state.characters.map((character) =>
      character.id === characterId ? { ...character, ...patch } : character,
    ),
  };
}

/** Pulls the point along (point - anchor) until it is exactly minDistance from anchor. */
function enforceMinDistance(point: Vec3, anchor: Vec3, minDistance: number): Vec3 {
  const offset = sub(point, anchor);
  const distance = lengthOf(offset);
  if (distance === 0 || !Number.isFinite(distance)) {
    // Caller guards this path; kept defensive rather than emitting NaN.
    return [...point] as Vec3;
  }
  return add(anchor, scale(offset, minDistance / distance));
}

// ---------------------------------------------------------------------------
// Simple semantic commands (novice-facing).
// ---------------------------------------------------------------------------

/**
 * Moves the camera a fixed fraction of the remaining distance toward its
 * CURRENT target, along the current position->target direction. The target
 * (what the camera looks at) is untouched, so the shot feel tightens without
 * re-aiming. Derived from live geometry; no template camera is hardcoded.
 */
export function makeCloser(state: ShotState): ShotState {
  const { position, target } = state.camera;
  const offset = sub(target, position);
  const distance = lengthOf(offset);
  if (distance <= MIN_CAMERA_TARGET_DISTANCE_M || !Number.isFinite(distance)) {
    throw new DegenerateCameraGeometryError("makeCloser", distance);
  }
  const direction = scale(offset, 1 / distance);
  const step = distance * CAMERA_DISTANCE_STEP_FRACTION;
  const candidate = add(position, scale(direction, step));
  const candidateDistance = lengthOf(sub(candidate, target));
  const next =
    candidateDistance < MIN_CAMERA_TARGET_DISTANCE_M
      ? enforceMinDistance(candidate, target, MIN_CAMERA_TARGET_DISTANCE_M)
      : candidate;
  const clamped = clampToBox(next, CAMERA_BOX);
  const finalDistance = lengthOf(sub(clamped, target));
  if (finalDistance < MIN_CAMERA_TARGET_DISTANCE_M) {
    throw new DegenerateCameraGeometryError("makeCloser", finalDistance);
  }
  return replaceCamera(state, { position: clamped });
}

/**
 * Moves the camera the same fraction away from its target, clamped to the
 * room box. At a wall the command becomes a stable no-op (idempotent),
 * never pulling the camera back closer to the target.
 */
export function makeFarther(state: ShotState): ShotState {
  const { position, target } = state.camera;
  const offset = sub(target, position);
  const distance = lengthOf(offset);
  if (distance <= MIN_CAMERA_TARGET_DISTANCE_M || !Number.isFinite(distance)) {
    throw new DegenerateCameraGeometryError("makeFarther", distance);
  }
  const direction = scale(offset, 1 / distance);
  const step = distance * CAMERA_DISTANCE_STEP_FRACTION;
  const candidate = clampToBox(sub(position, scale(direction, step)), CAMERA_BOX);
  const candidateDistance = lengthOf(sub(candidate, target));
  if (candidateDistance <= distance || candidateDistance < MIN_CAMERA_TARGET_DISTANCE_M) {
    // Wall reached (or clamping would move us closer): keep the current pose.
    return { ...state, camera: { ...state.camera } };
  }
  return replaceCamera(state, { position: candidate });
}

/**
 * Blends the camera target's horizontal components toward the emphasized
 * character's CURRENT position (the eye height stays whatever the state had;
 * no template position and no head height is hardcoded). Idempotent when the
 * target already sits over that character. The primary-subject semantics are
 * synchronized in the same command so the state never claims a different
 * primary subject than the one the target now emphasizes.
 */
export function emphasizeCharacter(state: ShotState, characterId: CharacterId): ShotState {
  const character = findCharacter(state, characterId);
  const { position, target } = state.camera;
  const candidate: Vec3 = [
    lerp(target[0], character.position[0], EMPHASIS_BLEND_FRACTION),
    target[1],
    lerp(target[2], character.position[2], EMPHASIS_BLEND_FRACTION),
  ];
  const clamped = clampToBox(candidate, TARGET_BOX);
  const distance = lengthOf(sub(clamped, position));
  if (distance < MIN_CAMERA_TARGET_DISTANCE_M) {
    throw new DegenerateCameraGeometryError(`emphasizeCharacter(${characterId})`, distance);
  }
  return {
    ...replaceCamera(state, { target: clamped }),
    semantics: syncPrimarySubjectSemantics(state.semantics, characterId),
  };
}

/**
 * Applies a provisional ENGINEERING focal-length preset. The 35/50 mm values
 * mirror the current templates; 24/85 mm are engineering extensions. These are
 * NOT director-approved rules.
 */
export function setFocalFeel(state: ShotState, preset: FocalFeelPresetId): ShotState {
  return setCameraFocalLength(state, FOCAL_FEEL_PRESETS[preset]);
}

/**
 * Sets the top-level aspect ratio. The value is validated at RUNTIME against
 * the same schema the content pipeline uses — a value outside {"16:9","9:16"}
 * is rejected, never written into the state.
 */
export function setAspectRatio(state: ShotState, aspectRatio: AspectRatio): ShotState {
  if (!aspectRatioSchema.safeParse(aspectRatio).success) {
    throw new InvalidCommandInputError("aspectRatio", aspectRatio);
  }
  return { ...state, aspectRatio };
}

// ---------------------------------------------------------------------------
// Constrained direct transforms (advanced 3D refinement).
// ---------------------------------------------------------------------------

export function setCameraPosition(state: ShotState, position: Vec3): ShotState {
  assertFiniteVec3("camera.position", position);
  const clamped = clampToBox(position, CAMERA_BOX);
  const distance = lengthOf(sub(clamped, state.camera.target));
  if (distance < MIN_CAMERA_TARGET_DISTANCE_M) {
    throw new DegenerateCameraGeometryError("setCameraPosition", distance);
  }
  return replaceCamera(state, { position: clamped });
}

export function setCameraTarget(state: ShotState, target: Vec3): ShotState {
  assertFiniteVec3("camera.target", target);
  const clamped = clampToBox(target, TARGET_BOX);
  const distance = lengthOf(sub(clamped, state.camera.position));
  if (distance < MIN_CAMERA_TARGET_DISTANCE_M) {
    throw new DegenerateCameraGeometryError("setCameraTarget", distance);
  }
  return replaceCamera(state, { target: clamped });
}

/**
 * Sets the current camera focal length, clamped to the Schema range
 * [FOCAL_LENGTH_MIN_MM, FOCAL_LENGTH_MAX_MM], and synchronizes the
 * `focal_*mm` optics semantics token so the state cannot carry two
 * contradictory focal facts. Movement start/end poses are deliberately
 * untouched (movement editing is out of Prompt 4 scope).
 */
export function setCameraFocalLength(state: ShotState, focalLengthMm: number): ShotState {
  assertFinite("camera.focalLengthMm", focalLengthMm);
  const clamped = clampToRange(focalLengthMm, {
    min: FOCAL_LENGTH_MIN_MM,
    max: FOCAL_LENGTH_MAX_MM,
  });
  return {
    ...replaceCamera(state, { focalLengthMm: clamped }),
    semantics: syncFocalSemantics(state.semantics, clamped),
  };
}

/**
 * Moves one character. The y coordinate is pinned to the floor (0) and x/z are
 * clamped to the room box; the command is refused if the result would bring
 * the two characters closer than MIN_CHARACTER_SEPARATION_M horizontally.
 */
export function setCharacterPosition(
  state: ShotState,
  characterId: CharacterId,
  position: Vec3,
): ShotState {
  assertFiniteVec3(`characters.${characterId}.position`, position);
  const clamped: Vec3 = [
    clampToRange(position[0], CHARACTER_POSITION_X_RANGE_M),
    CHARACTER_POSITION_Y_M,
    clampToRange(position[2], CHARACTER_POSITION_Z_RANGE_M),
  ];
  const other = state.characters.find((candidate) => candidate.id !== characterId);
  if (other !== undefined) {
    const separation = horizontalSeparationM(clamped, other.position);
    if (separation < MIN_CHARACTER_SEPARATION_M) {
      throw new CharacterOverlapError(characterId, separation);
    }
  }
  return replaceCharacter(state, characterId, { position: clamped });
}

/** Sets a character yaw, wrapped (not clamped) into [-180, 180]. */
export function setCharacterYaw(
  state: ShotState,
  characterId: CharacterId,
  yawDeg: number,
): ShotState {
  assertFinite(`characters.${characterId}.rotationYDeg`, yawDeg);
  const span = CHARACTER_YAW_RANGE_DEG.max - CHARACTER_YAW_RANGE_DEG.min; // 360
  const wrapped = ((((yawDeg + 180) % span) + span) % span) - 180;
  return replaceCharacter(state, characterId, { rotationYDeg: wrapped });
}

// ---------------------------------------------------------------------------
// Reset.
// ---------------------------------------------------------------------------

/**
 * Resets every editable value to the template defaults while KEEPING the
 * current ShotState ID (the session continues; only the adjustments are
 * undone). Selecting a template again is the operation that mints a new ID.
 */
export function resetShotStateToTemplate(state: ShotState, template: ShotTemplate): ShotState {
  return createShotStateFromTemplate(template, { generateId: () => state.id });
}

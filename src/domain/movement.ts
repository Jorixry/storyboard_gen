/**
 * Deterministic camera-movement interpolation (Prompt 5 / Phase 1 Day 5).
 *
 * Movement is exactly ONE start pose and ONE end pose in the canonical
 * ShotState (docs/ARCHITECTURE.md MovementState); this module derives any
 * intermediate camera pose from them with pure, framework-independent math.
 * It is a READ-ONLY derivation: interpolated poses are ephemeral preview or
 * capture inputs and are never written back into canonical state.
 *
 * Easing definitions (fixed, test-pinned):
 * - `linear`:      eased(t) = t
 * - `ease_in_out`: eased(t) = t^2 * (3 - 2t)  (smoothstep; symmetric, so the
 *   midpoint eased(0.5) = 0.5 for both easings)
 *
 * Progress policy: non-finite progress is rejected; finite progress outside
 * [0, 1] is clamped to the endpoints (a scrub control can overshoot; the
 * movement itself never can).
 *
 * No React, Next.js, Three.js or provider SDK imports are allowed here.
 */
import type { CameraPose, MovementState, Vec3 } from "./schemas";

/** Applies the movement's easing curve to a clamped progress value. */
export function easeProgress(easing: MovementState["easing"], progress: number): number {
  const t = clampProgress(progress);
  switch (easing) {
    case "linear":
      return t;
    case "ease_in_out":
      return t * t * (3 - 2 * t);
  }
}

/**
 * Interpolates the camera pose between the movement start and end poses at
 * the given progress (0 = start, 1 = end). Position, target and focal length
 * are each interpolated with the SAME eased progress; the focal length stays
 * inside the Schema range because both endpoint poses are in range and the
 * interpolation is convex.
 */
export function interpolateCameraPose(
  movement: Pick<MovementState, "start" | "end" | "easing">,
  progress: number,
): CameraPose {
  const eased = easeProgress(movement.easing, progress);
  return {
    position: lerpVec3(movement.start.position, movement.end.position, eased),
    target: lerpVec3(movement.start.target, movement.end.target, eased),
    focalLengthMm: lerp(movement.start.focalLengthMm, movement.end.focalLengthMm, eased),
  };
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    throw new RangeError(`movement progress must be a finite number; got ${progress}`);
  }
  return Math.min(Math.max(progress, 0), 1);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function lerpVec3(from: Vec3, to: Vec3, t: number): Vec3 {
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)];
}

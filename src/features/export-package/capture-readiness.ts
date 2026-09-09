/**
 * Capture-readiness gate for the raw-export PNG capture (Prompt 5 fix P1-1).
 *
 * A stage snapshot may only authorize encoding a frame when it numerically
 * matches the COMPLETE camera pose of the requested capture — position,
 * ORIENTATION (world direction), field of view — AND the canvas drawing
 * buffer already has the exact export raster size. The original bug compared
 * only position + FOV, so after switching from pose A to pose B with the same
 * position/FOV but a different target, the stale pose-A snapshot still
 * authorized toBlob() before the first pose-B frame existed (the encoded
 * PNG reused pose A's orientation).
 *
 * Why the matching frame is already on the canvas when a snapshot is
 * consumed (no sleeps needed):
 *
 *  1. DirectorStage's StageReporter runs inside useFrame and reports only
 *     after the active camera numerically equals the requested pose.
 *  2. R3F executes useFrame subscribers and then gl.render() synchronously
 *     within the SAME requestAnimationFrame task; the report's React state
 *     update flushes only after that task (scheduler macrotask or microtask),
 *     so the capture effect always observes the canvas AFTER the matching
 *     frame was rendered. `preserveDrawingBuffer: true` keeps it readable.
 *  3. The capture sequence is strictly serialized: the next pose is applied
 *     only after the previous toBlob() resolved, and nothing else mutates the
 *     hidden stage (it is driven exclusively by the frozen snapshot).
 *
 * Identical poses (static movement: current == start == end) intentionally
 * capture immediately from the previous pose's snapshot — an identical pose
 * produces an identical frame, and waiting for a "change" would hang.
 *
 * Pure module: no React/Three.js/browser imports; unit-testable in Node.
 */
import { verticalFovDeg } from "@/domain/camera-math";
import type { AspectRatio, CameraPose } from "@/domain/schemas";

/** The subset of DirectorStage's StageSnapshot the gate consumes. */
export interface CaptureSnapshot {
  view: "director" | "camera";
  activeCamera: {
    name: string;
    position: [number, number, number];
    fovDeg: number;
    worldDirection: [number, number, number];
  };
  drawingBuffer: { width: number; height: number };
}

export interface CaptureTargetDimensions {
  width: number;
  height: number;
}

/** Comparison tolerance: the stage reporter itself matches at 1e-6. */
const MATCH_TOLERANCE = 1e-6;

export const SHOT_CAMERA_NAME = "shot-camera";

/**
 * True when the snapshot proves the canvas is showing a fully rendered frame
 * of exactly this pose at exactly this raster size.
 */
export function poseMatchesSnapshot(
  pose: CameraPose,
  aspectRatio: AspectRatio,
  dimensions: CaptureTargetDimensions,
  snapshot: CaptureSnapshot,
): boolean {
  if (snapshot.view !== "camera" || snapshot.activeCamera.name !== SHOT_CAMERA_NAME) {
    return false;
  }
  if (
    snapshot.drawingBuffer.width !== dimensions.width ||
    snapshot.drawingBuffer.height !== dimensions.height
  ) {
    return false;
  }
  const position = snapshot.activeCamera.position;
  const positionMatches =
    Math.abs(position[0] - pose.position[0]) < MATCH_TOLERANCE &&
    Math.abs(position[1] - pose.position[1]) < MATCH_TOLERANCE &&
    Math.abs(position[2] - pose.position[2]) < MATCH_TOLERANCE;
  if (!positionMatches) {
    return false;
  }
  if (
    Math.abs(snapshot.activeCamera.fovDeg - verticalFovDeg(pose.focalLengthMm, aspectRatio)) >=
    MATCH_TOLERANCE
  ) {
    return false;
  }
  return directionMatches(snapshot.activeCamera.worldDirection, pose);
}

/**
 * Orientation gate — the fix for the target-only counterexample: the world
 * direction must point from the pose position at the pose TARGET, normalized.
 * This is what makes "same position + FOV, different target" fail against a
 * stale snapshot until the re-aimed frame exists.
 */
function directionMatches(worldDirection: readonly number[], pose: CameraPose): boolean {
  const dx = pose.target[0] - pose.position[0];
  const dy = pose.target[1] - pose.position[1];
  const dz = pose.target[2] - pose.position[2];
  const length = Math.hypot(dx, dy, dz);
  if (length === 0 || !Number.isFinite(length)) {
    // Degenerate pose (position on target): no well-defined direction. The
    // schema cannot produce this (commands refuse it), so treat as not-ready
    // rather than authorizing a frame with undefined orientation.
    return false;
  }
  return (
    Math.abs(worldDirection[0] - dx / length) < MATCH_TOLERANCE &&
    Math.abs(worldDirection[1] - dy / length) < MATCH_TOLERANCE &&
    Math.abs(worldDirection[2] - dz / length) < MATCH_TOLERANCE
  );
}

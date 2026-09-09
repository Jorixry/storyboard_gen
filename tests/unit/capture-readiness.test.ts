import { describe, expect, it } from "vitest";

import {
  poseMatchesSnapshot,
  type CaptureSnapshot,
} from "../../src/features/export-package/capture-readiness";
import type { CameraPose } from "../../src/domain/schemas";

/**
 * Capture-readiness gate (Prompt 5 fix P1-1). The regression at the center:
 * a stale snapshot whose position and FOV match the requested pose but whose
 * ORIENTATION (world direction) belongs to a previous, differently-aimed pose
 * must NOT authorize a capture. Values mirror the accepted counterexample:
 * dialogue_ots_a_to_b with camera.target.x edited from 0.8 to -0.8.
 */

const VFOV_50MM_169 = 22.895192527371208;

/** Current pose after the target-only edit (looks at x=-0.8). */
const TARGET_LEFT: CameraPose = {
  position: [-1.25, 1.7, 2],
  target: [-0.8, 1.55, 0],
  focalLengthMm: 50,
};

/** movement.start from the template (same position/FOV, looks at x=+0.8). */
const TARGET_RIGHT: CameraPose = {
  position: [-1.25, 1.7, 2],
  target: [0.8, 1.55, 0],
  focalLengthMm: 50,
};

const DIMENSIONS = { width: 1280, height: 720 };

function directionOf(pose: CameraPose): [number, number, number] {
  const dx = pose.target[0] - pose.position[0];
  const dy = pose.target[1] - pose.position[1];
  const dz = pose.target[2] - pose.position[2];
  const length = Math.hypot(dx, dy, dz);
  return [dx / length, dy / length, dz / length];
}

function snapshotFor(pose: CameraPose, overrides: Partial<CaptureSnapshot> = {}): CaptureSnapshot {
  return {
    view: "camera",
    activeCamera: {
      name: "shot-camera",
      position: [...pose.position] as [number, number, number],
      fovDeg: VFOV_50MM_169,
      worldDirection: directionOf(pose),
    },
    drawingBuffer: { ...DIMENSIONS },
    ...overrides,
  };
}

describe("poseMatchesSnapshot", () => {
  it("accepts a snapshot that numerically matches the complete pose", () => {
    expect(poseMatchesSnapshot(TARGET_LEFT, "16:9", DIMENSIONS, snapshotFor(TARGET_LEFT))).toBe(
      true,
    );
    expect(poseMatchesSnapshot(TARGET_RIGHT, "16:9", DIMENSIONS, snapshotFor(TARGET_RIGHT))).toBe(
      true,
    );
  });

  it("REGRESSION: rejects a stale snapshot with matching position/FOV but the old orientation", () => {
    // The snapshot still looks at target.x = -0.8 while movement.start aims at +0.8.
    const staleFromPreviousPose = snapshotFor(TARGET_LEFT);
    expect(poseMatchesSnapshot(TARGET_RIGHT, "16:9", DIMENSIONS, staleFromPreviousPose)).toBe(
      false,
    );
    // And symmetrically: a start-oriented snapshot cannot authorize the
    // re-aimed current composition.
    expect(poseMatchesSnapshot(TARGET_LEFT, "16:9", DIMENSIONS, snapshotFor(TARGET_RIGHT))).toBe(
      false,
    );
  });

  it("accepts identical poses (static movement: current == start == end)", () => {
    // The mechanism that lets static templates export: an earlier snapshot of
    // the SAME pose authorizes the next identical pose immediately.
    expect(poseMatchesSnapshot(TARGET_RIGHT, "16:9", DIMENSIONS, snapshotFor(TARGET_RIGHT))).toBe(
      true,
    );
  });

  it("rejects position drift beyond tolerance", () => {
    const drifted = snapshotFor(TARGET_LEFT, {
      activeCamera: {
        ...snapshotFor(TARGET_LEFT).activeCamera,
        position: [-1.25, 1.7, 2.01],
      },
    });
    expect(poseMatchesSnapshot(TARGET_LEFT, "16:9", DIMENSIONS, drifted)).toBe(false);
  });

  it("rejects a field-of-view mismatch (e.g. 9:16 gate vs 16:9 gate)", () => {
    const wrongFov = snapshotFor(TARGET_LEFT, {
      activeCamera: {
        ...snapshotFor(TARGET_LEFT).activeCamera,
        fovDeg: 39.59775270904986,
      },
    });
    expect(poseMatchesSnapshot(TARGET_LEFT, "16:9", DIMENSIONS, wrongFov)).toBe(false);
  });

  it("rejects a wrong drawing-buffer size (capture canvas not yet at export raster)", () => {
    const wrongBuffer = snapshotFor(TARGET_LEFT, {
      drawingBuffer: { width: 300, height: 150 },
    });
    expect(poseMatchesSnapshot(TARGET_LEFT, "16:9", DIMENSIONS, wrongBuffer)).toBe(false);
  });

  it("rejects director-view snapshots and non-shot cameras", () => {
    expect(
      poseMatchesSnapshot(
        TARGET_LEFT,
        "16:9",
        DIMENSIONS,
        snapshotFor(TARGET_LEFT, {
          view: "director",
        }),
      ),
    ).toBe(false);
    expect(
      poseMatchesSnapshot(
        TARGET_LEFT,
        "16:9",
        DIMENSIONS,
        snapshotFor(TARGET_LEFT, {
          activeCamera: {
            ...snapshotFor(TARGET_LEFT).activeCamera,
            name: "director-inspection-camera",
          },
        }),
      ),
    ).toBe(false);
  });

  it("rejects a degenerate pose (position on target) instead of authorizing undefined aim", () => {
    const degenerate: CameraPose = {
      position: [0, 1.5, 0],
      target: [0, 1.5, 0],
      focalLengthMm: 50,
    };
    expect(poseMatchesSnapshot(degenerate, "16:9", DIMENSIONS, snapshotFor(degenerate))).toBe(
      false,
    );
  });
});

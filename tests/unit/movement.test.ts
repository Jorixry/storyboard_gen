import { describe, expect, it } from "vitest";

import { easeProgress, interpolateCameraPose } from "../../src/domain/movement";
import type { MovementState } from "../../src/domain/schemas";

/**
 * Movement interpolation (Prompt 5 / Phase 1 Day 5). The dolly fixture mirrors
 * the committed dialogue_ots_a_to_b template movement exactly, so these tests
 * pin the same numbers the browser preview and the exported start/end frames
 * use. Easing definitions are test-pinned: linear = t, ease_in_out =
 * smoothstep t^2 * (3 - 2t).
 */

const OTS_A_TO_B_DOLLY: MovementState = {
  type: "dolly_in",
  start: { position: [-1.25, 1.7, 2.0], target: [0.8, 1.55, 0.0], focalLengthMm: 50 },
  end: { position: [-1.05, 1.68, 1.4], target: [0.8, 1.55, 0.0], focalLengthMm: 50 },
  durationSeconds: 4,
  easing: "ease_in_out",
};

const LINEAR_PUSH: MovementState = {
  type: "truck_left",
  start: { position: [0, 1.6, 3.4], target: [0, 1.55, 0], focalLengthMm: 35 },
  end: { position: [-1, 1.6, 3.4], target: [0, 1.55, 0], focalLengthMm: 85 },
  durationSeconds: 2,
  easing: "linear",
};

describe("easeProgress", () => {
  it("linear is the identity", () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(easeProgress("linear", t)).toBe(t);
    }
  });

  it("ease_in_out is smoothstep with fixed endpoints and symmetric midpoint", () => {
    expect(easeProgress("ease_in_out", 0)).toBe(0);
    expect(easeProgress("ease_in_out", 1)).toBe(1);
    expect(easeProgress("ease_in_out", 0.5)).toBe(0.5);
    expect(easeProgress("ease_in_out", 0.25)).toBeCloseTo(0.15625, 12);
    expect(easeProgress("ease_in_out", 0.75)).toBeCloseTo(0.84375, 12);
  });

  it("clamps finite progress outside [0, 1] to the endpoints", () => {
    expect(easeProgress("linear", -3)).toBe(0);
    expect(easeProgress("ease_in_out", 4)).toBe(1);
  });

  it("rejects non-finite progress", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => easeProgress("linear", bad)).toThrow(RangeError);
    }
  });
});

describe("interpolateCameraPose", () => {
  it("returns exactly the start pose at t=0 and the end pose at t=1", () => {
    expect(interpolateCameraPose(OTS_A_TO_B_DOLLY, 0)).toEqual(OTS_A_TO_B_DOLLY.start);
    expect(interpolateCameraPose(OTS_A_TO_B_DOLLY, 1)).toEqual(OTS_A_TO_B_DOLLY.end);
  });

  it("clamps overshooting progress to the endpoints (a scrub UI can overshoot)", () => {
    expect(interpolateCameraPose(OTS_A_TO_B_DOLLY, -0.5)).toEqual(OTS_A_TO_B_DOLLY.start);
    expect(interpolateCameraPose(OTS_A_TO_B_DOLLY, 1.5)).toEqual(OTS_A_TO_B_DOLLY.end);
  });

  it("rejects non-finite progress without producing NaN geometry", () => {
    expect(() => interpolateCameraPose(OTS_A_TO_B_DOLLY, Number.NaN)).toThrow(RangeError);
    expect(() => interpolateCameraPose(OTS_A_TO_B_DOLLY, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });

  it("interpolates position, target and focal length linearly for linear easing", () => {
    const mid = interpolateCameraPose(LINEAR_PUSH, 0.5);
    expect(mid.position[0]).toBeCloseTo(-0.5, 12);
    expect(mid.position[1]).toBeCloseTo(1.6, 12);
    expect(mid.position[2]).toBeCloseTo(3.4, 12);
    expect(mid.target).toEqual(LINEAR_PUSH.start.target);
    // 35 -> 85 mm crosses the template focal range mid at 60 mm.
    expect(mid.focalLengthMm).toBeCloseTo(60, 12);
  });

  it("hits the eased dolly-in poses for the OTS template values", () => {
    // eased(0.25) = 0.15625
    const quarter = interpolateCameraPose(OTS_A_TO_B_DOLLY, 0.25);
    expect(quarter.position[0]).toBeCloseTo(-1.25 + 0.2 * 0.15625, 12);
    expect(quarter.position[1]).toBeCloseTo(1.7 - 0.02 * 0.15625, 12);
    expect(quarter.position[2]).toBeCloseTo(2.0 - 0.6 * 0.15625, 12);
    // eased(0.5) = 0.5 (symmetric)
    const middle = interpolateCameraPose(OTS_A_TO_B_DOLLY, 0.5);
    expect(middle.position[0]).toBeCloseTo(-1.15, 12);
    expect(middle.position[1]).toBeCloseTo(1.69, 12);
    expect(middle.position[2]).toBeCloseTo(1.7, 12);
    // eased(0.75) = 0.84375
    const threeQuarters = interpolateCameraPose(OTS_A_TO_B_DOLLY, 0.75);
    expect(threeQuarters.position[2]).toBeCloseTo(2.0 - 0.6 * 0.84375, 12);
  });

  it("keeps both easings' midpoints identical (ease midpoint invariance)", () => {
    const eased = interpolateCameraPose(OTS_A_TO_B_DOLLY, 0.5);
    const linearMovement: MovementState = { ...OTS_A_TO_B_DOLLY, easing: "linear" };
    const linear = interpolateCameraPose(linearMovement, 0.5);
    expect(eased).toEqual(linear);
  });

  it("never mutates the movement it interpolates", () => {
    const before = JSON.stringify(OTS_A_TO_B_DOLLY);
    interpolateCameraPose(OTS_A_TO_B_DOLLY, 0.3);
    expect(JSON.stringify(OTS_A_TO_B_DOLLY)).toBe(before);
  });
});

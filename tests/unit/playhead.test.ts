import { describe, expect, it } from "vitest";

import {
  advancePlayhead,
  clampProgress,
  resolvePlayStart,
} from "../../src/features/movement-preview/playhead";

/**
 * Playhead timing (Prompt 5 fix P2-1), driven by a CONTROLLED clock: elapsed
 * milliseconds are explicit inputs, so no test sleeps. The movement under
 * test is 4 s (the OTS templates' duration).
 */

const FOUR_SECONDS_MS = 4000;

describe("advancePlayhead", () => {
  it("plays from 0 to 1 over exactly the full duration", () => {
    expect(advancePlayhead(0, 0, FOUR_SECONDS_MS)).toBe(0);
    expect(advancePlayhead(0, 1000, FOUR_SECONDS_MS)).toBe(0.25);
    expect(advancePlayhead(0, 2000, FOUR_SECONDS_MS)).toBe(0.5);
    expect(advancePlayhead(0, 3000, FOUR_SECONDS_MS)).toBe(0.75);
    expect(advancePlayhead(0, 4000, FOUR_SECONDS_MS)).toBe(1);
  });

  it("REGRESSION: resuming from the midpoint finishes in HALF the duration (full-timeline speed)", () => {
    // The bug: the old formula startProgress + span*(elapsed/duration) needed
    // the full 4 s for the remaining half. The fix traverses it in ~2 s.
    expect(advancePlayhead(0.5, 1000, FOUR_SECONDS_MS)).toBe(0.75);
    expect(advancePlayhead(0.5, 2000, FOUR_SECONDS_MS)).toBe(1);
    // And it never advances PAST the end while waiting: 2.5 s would overshoot
    // under the new speed, so it clamps at 1 (playback stops there).
    expect(advancePlayhead(0.5, 2500, FOUR_SECONDS_MS)).toBe(1);
  });

  it("discriminates against the old span-scaled formula at a quarter resume", () => {
    // Old buggy value from t=0.25 after 1 s: 0.25 + 0.75 * 0.25 = 0.4375.
    expect(advancePlayhead(0.25, 1000, FOUR_SECONDS_MS)).toBe(0.5);
  });

  it("clamps the result to [0, 1] for arbitrary elapsed times", () => {
    expect(advancePlayhead(0, 0, FOUR_SECONDS_MS)).toBe(0);
    expect(advancePlayhead(0, FOUR_SECONDS_MS * 10, FOUR_SECONDS_MS)).toBe(1);
    expect(advancePlayhead(0.9, FOUR_SECONDS_MS, FOUR_SECONDS_MS)).toBe(1);
  });

  it("rejects invalid elapsed/duration instead of emitting NaN or negative progress", () => {
    expect(() => advancePlayhead(0, -1, FOUR_SECONDS_MS)).toThrow(RangeError);
    expect(() => advancePlayhead(0, Number.NaN, FOUR_SECONDS_MS)).toThrow(RangeError);
    expect(() => advancePlayhead(0, 100, 0)).toThrow(RangeError);
    expect(() => advancePlayhead(0, 100, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("resolvePlayStart", () => {
  it("restarts from the beginning when pressed at the end (t >= 1)", () => {
    expect(resolvePlayStart(1)).toBe(0);
    expect(resolvePlayStart(1.0)).toBe(0);
  });

  it("resumes from the current paused position elsewhere", () => {
    expect(resolvePlayStart(0)).toBe(0);
    expect(resolvePlayStart(0.5)).toBe(0.5);
    expect(resolvePlayStart(0.42)).toBe(0.42);
  });

  it("clamps inputs into [0, 1] and rejects non-finite values", () => {
    expect(resolvePlayStart(-0.2)).toBe(0);
    expect(resolvePlayStart(1.5)).toBe(0);
    expect(() => resolvePlayStart(Number.NaN)).toThrow(RangeError);
  });
});

describe("clampProgress", () => {
  it("bounds progress to the movement interval", () => {
    expect(clampProgress(0)).toBe(0);
    expect(clampProgress(0.3)).toBe(0.3);
    expect(clampProgress(1)).toBe(1);
    expect(clampProgress(-1)).toBe(0);
    expect(clampProgress(2)).toBe(1);
    expect(() => clampProgress(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

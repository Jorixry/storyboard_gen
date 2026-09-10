import { describe, expect, it } from "vitest";

import {
  activeVerticalGateMm,
  assertValidFocalLengthMm,
  FILM_GATE_169_VERTICAL_MM,
  FILM_GATE_916_VERTICAL_MM,
  FILM_GATE_LONG_EDGE_MM,
  verticalFovDeg,
  verticalFovRad,
} from "@/domain/camera-math";

/**
 * Expected values are computed independently from the documented formula
 * `2 * atan(activeVerticalGateMm / (2 * focalLengthMm))` and hardcoded here,
 * so a wrong implementation (wrong gate, focal-as-FOV, swapped edges) cannot
 * pass by re-deriving its own output.
 */
describe("activeVerticalGateMm (36mm long-edge virtual film gate)", () => {
  it("exposes the documented gate constants", () => {
    expect(FILM_GATE_LONG_EDGE_MM).toBe(36);
    expect(FILM_GATE_169_VERTICAL_MM).toBe(20.25);
    expect(FILM_GATE_916_VERTICAL_MM).toBe(36);
  });

  it("uses the 20.25mm short edge as the 16:9 vertical gate, not the 36mm long edge", () => {
    expect(activeVerticalGateMm("16:9")).toBe(20.25);
    expect(activeVerticalGateMm("16:9")).not.toBe(36);
  });

  it("uses the rotated 36mm edge as the 9:16 vertical gate, not the 20.25mm edge", () => {
    expect(activeVerticalGateMm("9:16")).toBe(36);
    expect(activeVerticalGateMm("9:16")).not.toBe(20.25);
  });

  it("distinguishes the two aspect ratios at the same focal length", () => {
    expect(activeVerticalGateMm("9:16")).not.toBe(activeVerticalGateMm("16:9"));
  });
});

describe("verticalFovRad / verticalFovDeg", () => {
  it("matches the film-gate formula for 16:9 at the 50mm editable preset", () => {
    expect(verticalFovRad(50, "16:9")).toBeCloseTo(0.3995964924806295, 12);
    expect(verticalFovDeg(50, "16:9")).toBeCloseTo(22.895192527371208, 9);
  });

  it("matches the film-gate formula for 16:9 at 35mm (medium two-shot template)", () => {
    expect(verticalFovDeg(35, "16:9")).toBeCloseTo(32.26880217111643, 9);
  });

  it("matches the film-gate formula for 9:16 at 50mm (rotated gate)", () => {
    expect(verticalFovRad(50, "9:16")).toBeCloseTo(0.6911111611634242, 12);
    expect(verticalFovDeg(50, "9:16")).toBeCloseTo(39.59775270904986, 9);
  });

  it("never treats the focal length itself as a field of view", () => {
    for (const focalLengthMm of [12, 24, 35, 50, 85, 135, 200]) {
      for (const aspectRatio of ["16:9", "9:16"] as const) {
        const fovDeg = verticalFovDeg(focalLengthMm, aspectRatio);
        expect(fovDeg, `${focalLengthMm}mm ${aspectRatio}`).not.toBe(focalLengthMm);
        // atan-bounded: always a valid angle strictly between 0 and 180.
        expect(fovDeg).toBeLessThan(180);
        expect(fovDeg).toBeGreaterThan(0);
      }
    }
  });

  it("narrows as the focal length grows (atan denominator), unlike a passthrough", () => {
    const narrowing = [12, 24, 35, 50, 85, 135, 200].map((focalLengthMm) =>
      verticalFovDeg(focalLengthMm, "16:9"),
    );
    for (let index = 1; index < narrowing.length; index += 1) {
      expect(narrowing[index]).toBeLessThan(narrowing[index - 1]);
    }
  });

  it("gives a portrait 9:16 frame a larger vertical FOV than 16:9 at equal focal length", () => {
    expect(verticalFovDeg(50, "9:16")).toBeGreaterThan(verticalFovDeg(50, "16:9"));
  });

  it("converts radians to degrees exactly", () => {
    const rad = verticalFovRad(50, "16:9");
    expect(verticalFovDeg(50, "16:9")).toBeCloseTo((rad * 180) / Math.PI, 12);
  });
});

describe("focal-length validation", () => {
  it.each([0, -50, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 11, 201])(
    "rejects the invalid focal length %s before computing anything",
    (focalLengthMm) => {
      expect(() => assertValidFocalLengthMm(focalLengthMm)).toThrow(RangeError);
      expect(() => verticalFovRad(focalLengthMm, "16:9")).toThrow(RangeError);
      expect(() => verticalFovDeg(focalLengthMm, "9:16")).toThrow(RangeError);
    },
  );

  it("accepts the schema bounds 12mm and 200mm with correct film-gate results", () => {
    expect(() => assertValidFocalLengthMm(12)).not.toThrow();
    expect(() => assertValidFocalLengthMm(200)).not.toThrow();
    expect(verticalFovDeg(12, "16:9")).toBeCloseTo(80.31199924983865, 9);
    expect(verticalFovDeg(200, "16:9")).toBeCloseTo(5.796249337657643, 9);
    expect(verticalFovDeg(12, "9:16")).toBeCloseTo(112.61986494804043, 9);
  });

  it("never returns the degenerate values a missing guard would produce", () => {
    // These must throw instead of yielding 180°, a negative FOV, NaN or 0°.
    for (const focalLengthMm of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => verticalFovDeg(focalLengthMm, "16:9")).toThrow(RangeError);
    }
  });
});

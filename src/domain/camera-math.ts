/**
 * Focal-length to field-of-view conversion for the 36mm long-edge virtual
 * film gate defined by the engineering camera convention in
 * docs/ARCHITECTURE.md.
 *
 * Framework-independent by contract: this module must not import React,
 * Next.js, Three.js or any provider SDK. The rendering boundary converts the
 * returned angle to whatever unit its camera API expects.
 */
import { FOCAL_LENGTH_MAX_MM, FOCAL_LENGTH_MIN_MM, type AspectRatio } from "./schemas";

/** Virtual film gate long edge in millimetres (engineering convention). */
export const FILM_GATE_LONG_EDGE_MM = 36;

/** 16:9 gate: 36 x 20.25mm; the 20.25mm edge is vertical. */
export const FILM_GATE_169_VERTICAL_MM = 20.25;

/** 9:16 gate rotates to 20.25 x 36mm; the 36mm edge is vertical. */
export const FILM_GATE_916_VERTICAL_MM = 36;

/**
 * The gate edge that is vertical for the given aspect ratio.
 *
 * A 16:9 frame must use 20.25mm and a 9:16 frame must use 36mm; using the
 * long edge for both (or swapping them) is the class of bug this function
 * exists to make explicit and testable.
 */
export function activeVerticalGateMm(aspectRatio: AspectRatio): number {
  return aspectRatio === "16:9" ? FILM_GATE_169_VERTICAL_MM : FILM_GATE_916_VERTICAL_MM;
}

/**
 * Rejects focal lengths the domain schema cannot produce: non-finite numbers
 * (NaN, ±Infinity) and values outside [FOCAL_LENGTH_MIN_MM,
 * FOCAL_LENGTH_MAX_MM]. Without this guard, 0mm would yield a 180° FOV,
 * negative focal lengths a negative FOV, and NaN/Infinity would silently
 * propagate NaN/0° into the renderer.
 */
export function assertValidFocalLengthMm(focalLengthMm: number): void {
  if (!Number.isFinite(focalLengthMm)) {
    throw new RangeError(`focalLengthMm must be a finite number; got ${focalLengthMm}`);
  }
  if (focalLengthMm < FOCAL_LENGTH_MIN_MM || focalLengthMm > FOCAL_LENGTH_MAX_MM) {
    throw new RangeError(
      `focalLengthMm must be within [${FOCAL_LENGTH_MIN_MM}, ${FOCAL_LENGTH_MAX_MM}] mm; ` +
        `got ${focalLengthMm}`,
    );
  }
}

/**
 * Vertical field of view in radians:
 * `2 * atan(activeVerticalGateMm / (2 * focalLengthMm))`.
 *
 * The focal length is the denominator inside the atan, never a field-of-view
 * value itself.
 */
export function verticalFovRad(focalLengthMm: number, aspectRatio: AspectRatio): number {
  assertValidFocalLengthMm(focalLengthMm);
  return 2 * Math.atan(activeVerticalGateMm(aspectRatio) / (2 * focalLengthMm));
}

/** Vertical field of view in degrees, the unit Three.js' cameras consume. */
export function verticalFovDeg(focalLengthMm: number, aspectRatio: AspectRatio): number {
  return (verticalFovRad(focalLengthMm, aspectRatio) * 180) / Math.PI;
}

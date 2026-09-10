/**
 * Deterministic generic prompt compiler (Prompt 6 / Phase 2 Day 6).
 *
 * Renders the model-independent prompt from a NormalizedShotSpec following
 * content/adapters/generic-video.yaml: sections in the adapter's declared
 * ordering, tokens verbatim, geometry as exact numbers. The output is a pure
 * function of the input — no clock, locale, randomness, network or LLM.
 *
 * Contract (docs/ARCHITECTURE.md prompt compiler + WORKFLOWS.md §3):
 * - facts flow one way: NormalizedShotSpec -> text; this module never edits
 *   semantics, geometry or canonical state;
 * - conflicts are REPORTED as warnings, never silently fixed here — fixing
 *   belongs to editing commands plus semantic-sync on the ShotState;
 * - the section ordering below mirrors generic-video.yaml's `ordering`; a unit
 *   test parses that file and fails if the two drift apart;
 * - LLM polish is deliberately absent (generic-video.yaml `allowLlmPolish` is
 *   a Phase 2+ decision; the deterministic output must stand alone first).
 *
 * Framework-independent by contract: no React/Next/Three.js/provider imports.
 */
import type { NormalizedShotSpec } from "@/domain/normalized-spec";

/** Mirrors `id` in content/adapters/generic-video.yaml. */
export const GENERIC_PROMPT_ADAPTER_ID = "generic_video";

/** Mirrors `version` in content/adapters/generic-video.yaml. */
export const GENERIC_PROMPT_ADAPTER_VERSION = "1";

/** Mirrors `ordering` in content/adapters/generic-video.yaml. */
export const GENERIC_SECTION_ORDERING = [
  "subjects",
  "composition",
  "optics",
  "motion",
  "continuity",
] as const;

export interface CompiledGenericPrompt {
  adapterId: string;
  adapterVersion: string;
  /** Deterministic, model-independent prompt text. */
  prompt: string;
  /** Mechanical consistency warnings; empty for clean template states. */
  warnings: string[];
}

/** Matches the template optics token family, e.g. `focal_50mm`, `focal_62.5mm`. */
const FOCAL_TOKEN_PATTERN = /^focal_(\d+(?:\.\d+)?)mm$/;

/** The motion token family that asserts camera movement. */
const MOVEMENT_TOKEN_PATTERN = /^(subtle_)?(dolly|truck|pan|tilt|zoom)_/;

/** Fixed-precision number rendering keeps the text byte-deterministic. */
function formatNumber(value: number, fractionDigits: number): string {
  return value.toFixed(fractionDigits);
}

function formatVec3(values: readonly number[]): string {
  return `[${values.map((value) => formatNumber(value, 2)).join(", ")}]`;
}

function sectionLine(
  section: (typeof GENERIC_SECTION_ORDERING)[number],
  spec: NormalizedShotSpec,
): string {
  const tokens = spec.semantics[section].join(", ");
  return `${section}: ${tokens}`;
}

/**
 * Compiles the generic prompt. The section labels, wording and number formats
 * are part of the deterministic contract (snapshot-pinned); changing any of
 * them is a deliberate, reviewed output change.
 */
export function compileGenericPrompt(spec: NormalizedShotSpec): CompiledGenericPrompt {
  const warnings: string[] = [];

  const focalToken = spec.semantics.optics.find((token) => FOCAL_TOKEN_PATTERN.test(token));
  if (focalToken !== undefined) {
    const tokenFocal = Number(FOCAL_TOKEN_PATTERN.exec(focalToken)?.[1]);
    if (tokenFocal !== spec.focalLengthMm) {
      warnings.push(
        `optics token "${focalToken}" contradicts canonical focal length ${formatNumber(spec.focalLengthMm, 1)}mm`,
      );
    }
  } else {
    warnings.push(`optics carries no focal token for ${formatNumber(spec.focalLengthMm, 1)}mm`);
  }

  if (spec.movementType === "static") {
    const movementToken = spec.semantics.motion.find((token) => MOVEMENT_TOKEN_PATTERN.test(token));
    if (movementToken !== undefined) {
      warnings.push(`motion token "${movementToken}" contradicts movement type "static"`);
    }
  } else if (spec.semantics.motion.includes("static_camera")) {
    warnings.push(`motion token "static_camera" contradicts movement type "${spec.movementType}"`);
  }

  const lines: string[] = [
    `[${GENERIC_PROMPT_ADAPTER_ID} v${GENERIC_PROMPT_ADAPTER_VERSION}]`,
    `template: ${spec.templateId}@v${spec.templateVersion}`,
    `aspect ratio: ${spec.aspectRatio}`,
    `shot size: ${spec.shotSize}`,
    `primary subject: ${spec.primarySubject}`,
    `focal length: ${formatNumber(spec.focalLengthMm, 1)}mm`,
    `movement: ${spec.movementType}, ${formatNumber(spec.movementDurationSeconds, 1)}s, ${spec.movementEasing}`,
    ...GENERIC_SECTION_ORDERING.map((section) => sectionLine(section, spec)),
    `camera: position ${formatVec3(spec.geometry.camera.position)}, target ${formatVec3(spec.geometry.camera.target)}, ${formatNumber(spec.geometry.camera.focalLengthMm, 1)}mm`,
    `characters: ${spec.geometry.characters
      .map(
        (character) =>
          `${character.id} at ${formatVec3(character.position)} facing ${formatNumber(character.rotationYDeg, 0)}deg`,
      )
      .join("; ")}`,
  ];

  return {
    adapterId: GENERIC_PROMPT_ADAPTER_ID,
    adapterVersion: GENERIC_PROMPT_ADAPTER_VERSION,
    prompt: lines.join("\n"),
    warnings,
  };
}

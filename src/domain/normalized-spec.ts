/**
 * Normalized, model-independent shot specification (Prompt 6 / Phase 2 Day 6).
 *
 * `normalizeShotState` is the FIRST half of the prompt pipeline in
 * docs/ARCHITECTURE.md: it derives a model-independent semantic specification
 * from the canonical `ShotState`. The generic compiler (src/features/) and the
 * `VideoPromptAdapter` implementations consume this type; they never read the
 * raw ShotState and never receive provider-specific shapes here.
 *
 * Flow rules made structural by this module:
 * - ONE direction only: ShotState -> NormalizedShotSpec. There is no function
 *   that writes back into canonical state; editing commands keep mutating
 *   explicit ShotState fields (docs/ARCHITECTURE.md state-flow rules 3 and 6).
 * - Pure derivation: no React/Next/Three.js/provider imports, no side effects,
 *   no invented directing rules. Shot-size labels come from the canonical
 *   `camera.shotSize` the template shipped; continuity entries are the rule IDs
 *   the content already references (content/rules/continuity.yaml); the five
 *   semantics token lists pass through VERBATIM, so no director fact can be
 *   dropped, reworded or synthesized by normalization.
 * - `primarySubject` is derived from the exact primary-subject token family the
 *   templates ship (see semantic-sync.ts). Only when a state carries none of
 *   those tokens (possible after hand-crafted edits) does it fall back to a
 *   mechanical comparison of which character the camera target lies closer to
 *   — the same fact `syncPrimarySubjectSemantics` writes, read back out.
 */
import type {
  AspectRatio,
  CameraPose,
  CharacterId,
  Easing,
  MovementType,
  PromptSemantics,
  ShotSize,
  Vec3,
} from "./schemas";
import type { ShotState } from "./shot-state";

/** Whom the shot emphasizes, as the three template token families express it. */
export type PrimarySubject = "character_a" | "character_b" | "both";

/**
 * The five canonical semantics token groups (docs/ARCHITECTURE.md
 * promptSemantics). Normalization must preserve every group verbatim; this
 * constant exists so tests can enumerate the contract instead of hardcoding
 * field names per assertion.
 */
export const SEMANTIC_TOKEN_FIELDS = [
  "subjects",
  "composition",
  "optics",
  "motion",
  "continuity",
] as const;

/** Maps the exact shipped primary-subject tokens to normalized values. */
export const PRIMARY_SUBJECT_BY_TOKEN: Readonly<Record<string, PrimarySubject>> = {
  character_a_primary: "character_a",
  character_b_primary: "character_b",
  character_a_and_character_b_equal_prominence: "both",
};

/**
 * The model-independent semantic specification handed to prompt compilers and
 * versioned adapters. Flattened on purpose: the Prompt 1 adapter boundary
 * (`NormalizedShotSpec` in src/adapters/video-prompts/types.ts, now re-exported
 * from here) already consumed these flat fields, and geometry stays nested
 * under `geometry` so semantic consumers can ignore it while fact-checkers
 * (invariant tests, later LLM-polish guards) can read the exact numbers.
 */
export interface NormalizedShotSpec {
  templateId: string;
  templateVersion: number;
  aspectRatio: AspectRatio;
  /** Canonical current camera focal length in millimetres (36mm long-edge gate). */
  focalLengthMm: number;
  /** Canonical shot-size label shipped by the template (no geometric re-derivation). */
  shotSize: ShotSize;
  primarySubject: PrimarySubject;
  movementType: MovementType;
  movementDurationSeconds: number;
  movementEasing: Easing;
  /** Rule IDs referenced by `semantics.continuity` (content/rules/continuity.yaml). */
  continuityRuleIds: string[];
  /** The five director token groups, passed through verbatim. */
  semantics: PromptSemantics;
  /** Exact geometric facts the spec was derived from; the fact-check basis. */
  geometry: {
    camera: CameraPose;
    characters: Array<{ id: CharacterId; position: Vec3; rotationYDeg: number }>;
    /** Euclidean camera-position-to-character-position distances, metres. */
    cameraToCharacterDistanceM: { character_a: number; character_b: number };
  };
}

/**
 * Derives the normalized specification from one canonical ShotState. Pure and
 * total: the input is schema-validated state, the output shares no mutable
 * reference with it, and equal states always normalize to equal specs.
 */
export function normalizeShotState(shotState: ShotState): NormalizedShotSpec {
  return {
    templateId: shotState.template.id,
    templateVersion: shotState.template.version,
    aspectRatio: shotState.aspectRatio,
    focalLengthMm: shotState.camera.focalLengthMm,
    shotSize: shotState.camera.shotSize,
    primarySubject: derivePrimarySubject(shotState),
    movementType: shotState.movement.type,
    movementDurationSeconds: shotState.movement.durationSeconds,
    movementEasing: shotState.movement.easing,
    continuityRuleIds: [...shotState.semantics.continuity],
    semantics: copySemantics(shotState.semantics),
    geometry: {
      camera: copyPose(shotState.camera),
      characters: shotState.characters.map((character) => ({
        id: character.id,
        position: [...character.position] as Vec3,
        rotationYDeg: character.rotationYDeg,
      })),
      cameraToCharacterDistanceM: {
        character_a: distance(shotState.camera.position, positionOf(shotState, "character_a")),
        character_b: distance(shotState.camera.position, positionOf(shotState, "character_b")),
      },
    },
  };
}

/**
 * Token-first primary-subject derivation. The fallback compares which
 * character position the camera TARGET is closer to (ties -> both): the
 * mechanical inverse of the emphasize command's target move, never a new
 * directing rule.
 */
function derivePrimarySubject(shotState: ShotState): PrimarySubject {
  for (const token of shotState.semantics.subjects) {
    const mapped = PRIMARY_SUBJECT_BY_TOKEN[token];
    if (mapped !== undefined) {
      return mapped;
    }
  }
  const toA = distance(shotState.camera.target, positionOf(shotState, "character_a"));
  const toB = distance(shotState.camera.target, positionOf(shotState, "character_b"));
  if (toA === toB) {
    return "both";
  }
  return toA < toB ? "character_a" : "character_b";
}

function positionOf(shotState: ShotState, id: CharacterId): Vec3 {
  const character = shotState.characters.find((candidate) => candidate.id === id);
  if (character === undefined) {
    // Unreachable for schema-valid state: exactly character_a and character_b.
    throw new Error(`ShotState is missing ${id}`);
  }
  return character.position;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function copyPose(pose: CameraPose): CameraPose {
  return {
    position: [...pose.position] as Vec3,
    target: [...pose.target] as Vec3,
    focalLengthMm: pose.focalLengthMm,
  };
}

function copySemantics(semantics: PromptSemantics): PromptSemantics {
  return {
    subjects: [...semantics.subjects],
    composition: [...semantics.composition],
    optics: [...semantics.optics],
    motion: [...semantics.motion],
    continuity: [...semantics.continuity],
  };
}

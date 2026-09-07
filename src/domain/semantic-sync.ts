/**
 * Canonical-semantics synchronization for editing commands (Prompt 4 fix).
 *
 * The canonical ShotState carries both the executable camera/character values
 * AND the structured prompt semantics derived from the template. When an
 * editing command changes a value those semantics describe, the semantics must
 * be updated in the same command — otherwise the state contains two mutually
 * contradictory facts (e.g. `camera.focalLengthMm: 85` next to an optics token
 * `focal_50mm`, or a target aimed at character A next to
 * `character_b_primary`).
 *
 * This is an ENGINEERING consistency rule, not new director knowledge:
 * - focal tokens follow the existing template convention `focal_35mm` /
 *   `focal_50mm` and generalize to the clamped focal length;
 * - the primary-subject tokens are exactly the three the current templates
 *   ship (`character_a_primary`, `character_b_primary`,
 *   `character_a_and_character_b_equal_prominence`);
 * - only tokens in these two families are replaced; every other semantic
 *   token (composition, continuity, foreground-shoulder optics, ...) is kept
 *   verbatim, because mapping e.g. framing to a distance step would invent
 *   directing rules the Director has not supplied (see docs/OPEN_QUESTIONS.md).
 *
 * Framework-independent by contract: no React/Next/Three.js/provider imports.
 */
import type { CharacterId, PromptSemantics } from "./schemas";

/** Matches the template optics tokens, e.g. `focal_35mm`, `focal_62.5mm`. */
export const FOCAL_SEMANTIC_PATTERN = /^focal_\d+(?:\.\d+)?mm$/;

/** The exact primary-subject token family found in the current templates. */
export const PRIMARY_SUBJECT_SEMANTIC_PATTERNS = [
  /^character_a_primary$/,
  /^character_b_primary$/,
  /^character_a_and_character_b_equal_prominence$/,
] as const;

function tokenMatches(token: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(token));
}

/**
 * Replaces every token matching one of the patterns with `replacement`
 * (inserted at the position of the first removed token, or appended when no
 * token matched). Idempotent, order-stable and never produces duplicates.
 */
function replaceMatchingTokens(
  list: readonly string[],
  patterns: readonly RegExp[],
  replacement: string,
): string[] {
  const firstIndex = list.findIndex((token) => tokenMatches(token, patterns));
  const kept = list.filter((token) => !tokenMatches(token, patterns));
  if (firstIndex === -1) {
    return kept.includes(replacement) ? kept : [...kept, replacement];
  }
  const insertAt = Math.min(firstIndex, kept.length);
  return [...kept.slice(0, insertAt), replacement, ...kept.slice(insertAt)];
}

/** The canonical focal token for a (clamped) focal length in millimetres. */
export function focalSemanticToken(focalLengthMm: number): string {
  return `focal_${focalLengthMm}mm`;
}

/** The canonical primary-subject token for the emphasized character. */
export function primarySubjectSemanticToken(characterId: CharacterId): string {
  return characterId === "character_a" ? "character_a_primary" : "character_b_primary";
}

/**
 * Keeps `semantics.optics` consistent with the camera's current focal length:
 * any `focal_*mm` token is replaced by the token for `focalLengthMm`.
 */
export function syncFocalSemantics(
  semantics: PromptSemantics,
  focalLengthMm: number,
): PromptSemantics {
  return {
    ...semantics,
    optics: replaceMatchingTokens(
      semantics.optics,
      [FOCAL_SEMANTIC_PATTERN],
      focalSemanticToken(focalLengthMm),
    ),
  };
}

/**
 * Keeps `semantics.subjects` consistent with whom the camera target
 * emphasizes: any primary-subject token is replaced by the emphasized
 * character's primary token.
 */
export function syncPrimarySubjectSemantics(
  semantics: PromptSemantics,
  characterId: CharacterId,
): PromptSemantics {
  return {
    ...semantics,
    subjects: replaceMatchingTokens(
      semantics.subjects,
      PRIMARY_SUBJECT_SEMANTIC_PATTERNS,
      primarySubjectSemanticToken(characterId),
    ),
  };
}

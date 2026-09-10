/**
 * Deterministic generic (model-agnostic) VideoPromptAdapter — Prompt 6 /
 * Phase 2 §2.1. This is the local mock/generic adapter; it supersedes the
 * Prompt 1 placeholder and is the ONLY prompt pipeline in the repository.
 *
 * Contract:
 * - pure function of the validated NormalizedShotSpec plus the injected,
 *   content-pipeline-validated adapter config (content/adapters/generic-video.yaml):
 *   identical inputs produce byte-identical prompts and warnings, in the same
 *   order — no randomness, no clocks, no network, no credentials, no LLM;
 * - the output is a MODEL-AGNOSTIC ENGINEERING REFERENCE. It is not tuned for
 *   any specific video model and claims support for none (Seedance included);
 * - structured numbers are geometry facts: every number is rendered at the
 *   exact precision of the canonical ShotState (no rounding anywhere), and
 *   semantic tokens never override coordinates, focal length or movement —
 *   contradictions become warnings;
 * - unknown semantic tokens are rendered VERBATIM (never dropped, never given
 *   an invented directing meaning) and are reported in a locatable warning;
 * - the CURRENT camera pose and the movement start/end poses are rendered as
 *   three distinct facts, never merged;
 * - the adapter does not mutate its input.
 *
 * Token recognition uses EXPLICIT PER-CATEGORY rules (Prompt 6 fix round):
 * a token is only interpreted when it matches its family's exact pattern AND
 * sits in that family's home category. The families mirror the established
 * semantic-sync pairings (src/domain/semantic-sync.ts):
 * - `focal_<mm>mm` (optics) <-> camera.focalLengthMm;
 * - `character_a_primary` / `character_b_primary` /
 *   `character_a_and_character_b_equal_prominence` (subjects) <-> the
 *   character the camera target is nearest to (primary only; equal-prominence
 *   is recognized but not geometrically checked — no director-approved rule,
 *   see docs/OPEN_QUESTIONS.md);
 * - the exact motion-token table below (motion) <-> movement.type.
 * Substring matching is deliberately NOT used: `not_dolly_in` and
 * `mystery_dolly_in_v99` are NOT motion tokens. A family token in the wrong
 * category is a locatable category-mismatch warning, kept verbatim and not
 * interpreted; that warning names the authoritative structured field
 * (camera.focalLengthMm / movement.type / camera-target geometry), never a
 * semantics category — a category can itself carry a stale token. Every
 * other token has no generic interpretation and is reported as uninterpreted.
 */
import { FOCAL_SEMANTIC_PATTERN, PRIMARY_SUBJECT_SEMANTIC_PATTERNS } from "@/domain/semantic-sync";
import { normalizedShotSpecSchema, type NormalizedShotSpec } from "@/domain/prompt-normalization";
import type { CharacterId, MovementType, SemanticCategory, Vec3 } from "@/domain/schemas";
import {
  videoPromptAdapterConfigSchema,
  type VideoPromptAdapterConfig,
} from "@/domain/video-adapter-config";

import type { CompiledPrompt, VideoPromptAdapter } from "./types";

export const GENERIC_VIDEO_ADAPTER_ID = "generic_video";
export const GENERIC_VIDEO_ADAPTER_VERSION = "1.0.0";

/**
 * The ONLY motion tokens the adapter recognizes (exact matches), mapped to
 * the movement each one names: the movement-type enum plus the `subtle_`
 * family used by the current templates. Nothing containing these strings is
 * interpreted unless it IS one of these tokens.
 */
const MOTION_TOKEN_MOVEMENTS: Readonly<Record<string, MovementType>> = {
  static: "static",
  static_camera: "static",
  dolly_in: "dolly_in",
  subtle_dolly_in: "dolly_in",
  dolly_out: "dolly_out",
  subtle_dolly_out: "dolly_out",
  truck_left: "truck_left",
  subtle_truck_left: "truck_left",
  truck_right: "truck_right",
  subtle_truck_right: "truck_right",
};

/** The home category of each recognized token family. */
type TokenFamily = "focal" | "primary" | "motion";

const FAMILY_HOME_CATEGORY: Record<TokenFamily, SemanticCategory> = {
  focal: "optics",
  primary: "subjects",
  motion: "motion",
};

/**
 * The structured FIELD each family's executable fact lives in. Wrong-category
 * warnings name this field — never a semantics category — because a category
 * is a token container, not an authority: it can itself carry a stale token,
 * and only structured state fields (camera.focalLengthMm, movement.type, the
 * camera-target geometry) are authoritative.
 */
const FAMILY_AUTHORITY_FIELD: Record<TokenFamily, string> = {
  focal: "camera.focalLengthMm",
  primary: "camera.target geometry",
  motion: "movement.type",
};

function tokenFamily(token: string): TokenFamily | null {
  if (FOCAL_SEMANTIC_PATTERN.test(token)) {
    return "focal";
  }
  if (PRIMARY_SUBJECT_SEMANTIC_PATTERNS.some((pattern) => pattern.test(token))) {
    return "primary";
  }
  if (Object.hasOwn(MOTION_TOKEN_MOVEMENTS, token)) {
    return "motion";
  }
  return null;
}

function primaryTokenCharacter(token: string): CharacterId | null {
  if (token === "character_a_primary") {
    return "character_a";
  }
  if (token === "character_b_primary") {
    return "character_b";
  }
  return null; // equal-prominence: recognized, but no geometric rule to check
}

/**
 * Deterministic number rendering at FULL state precision: JS number-to-string
 * (shortest round-trip decimal form). No rounding is applied anywhere, so the
 * prompt carries exactly the numbers the canonical ShotState carries, and any
 * "verbatim" claim in a warning is literally true. `-0` normalizes to "0";
 * extreme magnitudes use exponential form, which is still exact and distinct.
 */
function formatNumber(value: number): string {
  return String(value);
}

function formatVec3(vector: Vec3): string {
  return `[${vector.map(formatNumber).join(", ")}]`;
}

function horizontalDistanceM(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function posesDiffer(
  start: NormalizedShotSpec["movement"]["start"],
  end: NormalizedShotSpec["movement"]["end"],
): string[] {
  const fields: string[] = [];
  if (start.position.some((v, i) => v !== end.position[i])) {
    fields.push("position");
  }
  if (start.target.some((v, i) => v !== end.target[i])) {
    fields.push("target");
  }
  if (start.focalLengthMm !== end.focalLengthMm) {
    fields.push("focal");
  }
  return fields;
}

export class GenericVideoPromptAdapter implements VideoPromptAdapter {
  readonly id = GENERIC_VIDEO_ADAPTER_ID;
  readonly version = GENERIC_VIDEO_ADAPTER_VERSION;
  private readonly config: VideoPromptAdapterConfig;

  /**
   * The config comes from the content pipeline (content/adapters/
   * generic-video.yaml). It is re-validated here so a hand-edited or drifted
   * config can never reach compilation; a config for a different adapter id is
   * refused rather than silently consumed.
   */
  constructor(config: VideoPromptAdapterConfig) {
    const parsed = videoPromptAdapterConfigSchema.parse(config);
    if (parsed.id !== GENERIC_VIDEO_ADAPTER_ID) {
      throw new Error(
        `GenericVideoPromptAdapter only consumes the "${GENERIC_VIDEO_ADAPTER_ID}" adapter config; got "${parsed.id}"`,
      );
    }
    this.config = parsed;
  }

  get configVersion(): number {
    return this.config.version;
  }

  async compile(input: NormalizedShotSpec): Promise<CompiledPrompt> {
    const spec = normalizedShotSpecSchema.parse(input);
    const warnings = this.collectWarnings(spec);
    const prompt = this.render(spec);
    return {
      adapterId: this.id,
      adapterVersion: this.version,
      adapterConfigVersion: this.config.version,
      prompt,
      warnings,
      source: {
        shotStateId: spec.state.id,
        shotStateSchemaVersion: spec.state.schemaVersion,
        templateId: spec.template.id,
        templateVersion: spec.template.version,
        templateReviewStatus: spec.template.reviewStatus,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Warnings (fixed emission order; deterministic).
  // -------------------------------------------------------------------------

  private collectWarnings(spec: NormalizedShotSpec): string[] {
    const warnings: string[] = [];

    if (spec.template.reviewStatus !== "approved") {
      warnings.push(
        `template: reviewStatus "${spec.template.reviewStatus}" is not "approved"; ` +
          "directing semantics are engineering-derived and not professionally verified",
      );
    }

    if (this.config.constraints.allowLlmPolish) {
      warnings.push(
        `adapter-config: allowLlmPolish=true but LLM polish is not implemented; ` +
          `output is deterministic text only (llmMayChange: ${this.config.constraints.llmMayChange.join(", ")})`,
      );
    }

    const differing = posesDiffer(spec.movement.start, spec.movement.end);
    if (spec.movement.type === "static" && differing.length > 0) {
      warnings.push(
        `movement: type=static but start and end poses differ (${differing.join(", ")}); ` +
          "both poses are expressed verbatim",
      );
    } else if (spec.movement.type !== "static" && differing.length === 0) {
      warnings.push(
        `movement: type=${spec.movement.type} is declared but start and end poses are identical; ` +
          "no displacement is expressed",
      );
    }

    // Per-category token classification (config ordering, token order within
    // each category): recognized-in-place tokens are fact-checked; recognized
    // tokens in the wrong category get a category-mismatch warning; everything
    // else is collected as uninterpreted.
    const characterA = spec.characters.find((c) => c.id === "character_a")!.position;
    const characterB = spec.characters.find((c) => c.id === "character_b")!.position;
    const distA = horizontalDistanceM(spec.camera.target, characterA);
    const distB = horizontalDistanceM(spec.camera.target, characterB);
    const nearest: CharacterId | null =
      distA < distB ? "character_a" : distB < distA ? "character_b" : null;

    const uninterpreted: string[] = [];
    for (const category of this.config.ordering) {
      spec.semantics[category].forEach((token, index) => {
        const location = `semantics.${category}[${index}]`;
        const family = tokenFamily(token);
        if (family === null) {
          uninterpreted.push(`${category}[${index}]=${token}`);
          return;
        }
        const home = FAMILY_HOME_CATEGORY[family];
        if (home !== category) {
          warnings.push(
            `${location}: "${token}" is a ${family} token but appears in "${category}" ` +
              `(expected "${home}"); kept verbatim and not interpreted; ` +
              `the executable fact remains ${FAMILY_AUTHORITY_FIELD[family]}`,
          );
          return;
        }
        if (family === "focal") {
          const tokenMm = Number(token.replace(/^focal_/, "").replace(/mm$/, ""));
          if (tokenMm !== spec.camera.focalLengthMm) {
            warnings.push(
              `${location}: "${token}" conflicts with camera.focalLengthMm=` +
                `${formatNumber(spec.camera.focalLengthMm)}mm; the structured number is authoritative`,
            );
          }
          return;
        }
        if (family === "primary") {
          const claimed = primaryTokenCharacter(token);
          if (claimed !== null && nearest !== null && claimed !== nearest) {
            warnings.push(
              `${location}: "${token}" conflicts with the camera target, which is ` +
                `nearest to ${nearest} (${formatNumber(distA)}m vs ${formatNumber(distB)}m); ` +
                "camera geometry is authoritative",
            );
          }
          return;
        }
        // family === "motion": exact table lookup, never substring inference.
        if (MOTION_TOKEN_MOVEMENTS[token] !== spec.movement.type) {
          warnings.push(
            `${location}: "${token}" names movement "${MOTION_TOKEN_MOVEMENTS[token]}" but ` +
              `movement.type=${spec.movement.type}; the structured movement is authoritative`,
          );
        }
      });
    }
    if (uninterpreted.length > 0) {
      warnings.push(
        `semantics: ${uninterpreted.length} token(s) have no generic-adapter interpretation; ` +
          `rendered verbatim without invented meaning (${uninterpreted.join(", ")})`,
      );
    }

    return warnings;
  }

  // -------------------------------------------------------------------------
  // Prompt rendering (section order driven by the adapter config).
  // -------------------------------------------------------------------------

  private render(spec: NormalizedShotSpec): string {
    const approved = spec.template.reviewStatus === "approved";
    const header = [
      "generic-video-prompt: model-agnostic engineering reference; " +
        "not tuned for and not claiming support of any specific video model",
      `source: shot-state=${spec.state.id} state-schema=v${spec.state.schemaVersion} ` +
        `template=${spec.template.id}@v${spec.template.version} ` +
        `review-status=${spec.template.reviewStatus} adapter=${this.id}@${this.version} ` +
        `adapter-config=v${this.config.version}`,
      approved
        ? "note: compiled deterministically from the canonical ShotState; " +
          "template review status is approved"
        : "note: compiled deterministically from the canonical ShotState; template review status " +
          `is ${spec.template.reviewStatus}, so directing semantics (incl. shoulder-frame share, ` +
          "depth of field, axis and eyeline) are engineering-derived and NOT professionally verified",
      `protected-facts (must survive any later polish): ${this.config.constraints.llmMayNotChange.join(", ")}`,
    ];

    const facts = [
      `scene: ${spec.scene.presetId}`,
      `aspect-ratio: ${spec.aspectRatio}`,
      `camera.current: position=${formatVec3(spec.camera.position)} ` +
        `target=${formatVec3(spec.camera.target)} ` +
        `focal=${formatNumber(spec.camera.focalLengthMm)}mm shot-size=${spec.camera.shotSize}`,
      `characters: ${spec.characters
        .map(
          (character) =>
            `${character.id} position=${formatVec3(character.position)} ` +
            `facing=${formatNumber(character.rotationYDeg)}deg`,
        )
        .join("; ")}`,
      `movement: type=${spec.movement.type} ` +
        `duration=${formatNumber(spec.movement.durationSeconds)}s easing=${spec.movement.easing}`,
      `movement.start: position=${formatVec3(spec.movement.start.position)} ` +
        `target=${formatVec3(spec.movement.start.target)} ` +
        `focal=${formatNumber(spec.movement.start.focalLengthMm)}mm`,
      `movement.end: position=${formatVec3(spec.movement.end.position)} ` +
        `target=${formatVec3(spec.movement.end.target)} ` +
        `focal=${formatNumber(spec.movement.end.focalLengthMm)}mm`,
    ];

    const semantics = this.config.ordering.map(
      (category: SemanticCategory) => `${category}: ${spec.semantics[category].join("; ")}`,
    );

    return [...header, "", ...facts, "", ...semantics].join("\n");
  }
}

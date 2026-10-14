/**
 * Deterministic Seedance target-model VideoPromptAdapter — Prompt 8 (Phase 2
 * §2.3, developer option a, 2026-10-08). The ONE versioned target-model prompt
 * adapter the MVP export package carries next to the Prompt 6 generic one.
 *
 * Status: ENGINEERING-DERIVED. It follows the official prompt guidance
 * surveyed in docs/Seedance-API-调研报告-2026-09-14.md (Shot-structured beats
 * second-level time codes on 2.x; descriptive camera language instead of
 * parametrized focal/ISO/f-number values; ONE main camera movement per
 * generation; no negative_prompt parameter exists). It does NOT claim official
 * Seedance support: D026 account-level verification is still open, and every
 * output says so.
 *
 * Contract (mirrors the generic adapter's guarantees):
 * - pure function of the validated NormalizedShotSpec plus the injected,
 *   content-pipeline-validated adapter config (content/adapters/seedance-video.yaml):
 *   identical inputs produce byte-identical prompts and warnings in the same order;
 * - structured numbers stay out of the prose ON PURPOSE (official guidance) —
 *   geometry is carried by the exported reference images and shot-state.json;
 * - the CURRENT camera pose and the movement start/end poses are reflected as
 *   distinct facts in the warnings, never merged;
 * - the adapter does not mutate its input and performs no I/O.
 */
import { normalizedShotSpecSchema, type NormalizedShotSpec } from "@/domain/prompt-normalization";
import type { MovementType, SemanticCategory } from "@/domain/schemas";
import {
  videoPromptAdapterConfigSchema,
  type VideoPromptAdapterConfig,
} from "@/domain/video-adapter-config";

import type { CompiledPrompt, VideoPromptAdapter } from "./types";

export const SEEDANCE_VIDEO_ADAPTER_ID = "seedance_video";
export const SEEDANCE_VIDEO_ADAPTER_VERSION = "1.0.0";

/**
 * Descriptive movement language per the surveyed official guidance (one main
 * camera movement, rhythm words instead of technical parameters). The English
 * token in parentheses keeps the structured movement.type traceable.
 */
const MOVEMENT_DESCRIPTIONS: Readonly<Record<MovementType, string>> = {
  static: "固定机位，画面保持稳定（static camera）",
  dolly_in: "镜头缓慢推近被摄主体（slow dolly in）",
  dolly_out: "镜头缓慢拉远离被摄主体（slow dolly out）",
  truck_left: "镜头缓慢向左平移（slow truck left）",
  truck_right: "镜头缓慢向右平移（slow truck right）",
};

function formatNumber(value: number): string {
  return String(value);
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

export class SeedanceVideoPromptAdapter implements VideoPromptAdapter {
  readonly id = SEEDANCE_VIDEO_ADAPTER_ID;
  readonly version = SEEDANCE_VIDEO_ADAPTER_VERSION;
  private readonly config: VideoPromptAdapterConfig;

  /**
   * The config comes from the content pipeline (content/adapters/
   * seedance-video.yaml); it is re-validated here so a hand-edited or drifted
   * config can never reach compilation, and a config authored for another
   * adapter id is refused rather than silently consumed.
   */
  constructor(config: VideoPromptAdapterConfig) {
    const parsed = videoPromptAdapterConfigSchema.parse(config);
    if (parsed.id !== SEEDANCE_VIDEO_ADAPTER_ID) {
      throw new Error(
        `SeedanceVideoPromptAdapter only consumes the "${SEEDANCE_VIDEO_ADAPTER_ID}" adapter config; got "${parsed.id}"`,
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
        stateFingerprint: spec.state.stateFingerprint,
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
        `template: reviewStatus "${spec.template.reviewStatus}" is not "approved"; directing semantics are engineering-derived and not professionally verified`,
      );
    }

    const differing = posesDiffer(spec.movement.start, spec.movement.end);
    if (spec.movement.type === "static" && differing.length > 0) {
      warnings.push(
        `movement: type=static but start and end poses differ (${differing.join(", ")}); ` +
          "the exported start/end guide images still express both poses verbatim",
      );
    } else if (spec.movement.type !== "static" && differing.length === 0) {
      warnings.push(
        `movement: type=${spec.movement.type} is declared but start and end poses are identical; ` +
          "no displacement is expressed",
      );
    }

    return warnings;
  }

  // -------------------------------------------------------------------------
  // Prompt rendering (Shot-structured, descriptive, config-ordered semantics).
  // -------------------------------------------------------------------------

  private render(spec: NormalizedShotSpec): string {
    const approved = spec.template.reviewStatus === "approved";
    const header = [
      "seedance-prompt: engineering-derived target-model draft (Seedance, D026 provisional); " +
        "NOT claiming official Seedance support",
      `source: shot-state=${spec.state.id} state-schema=v${spec.state.schemaVersion} ` +
        `template=${spec.template.id}@v${spec.template.version} ` +
        `review-status=${spec.template.reviewStatus} adapter=${this.id}@${this.version} ` +
        `adapter-config=v${this.config.version}`,
      "note: compiled deterministically from the canonical ShotState following the official prompt " +
        "guidance surveyed in docs/Seedance-API-调研报告-2026-09-14.md (Shot-structured, descriptive " +
        "camera language, one main camera movement, no parametrized focal/ISO/f-number); " +
        (approved
          ? "template review status is approved"
          : `template review status is ${spec.template.reviewStatus}, so directing semantics are ` +
            "engineering-derived and NOT professionally verified"),
      `protected-facts (must survive any later polish): ${this.config.constraints.llmMayNotChange.join(", ")}`,
      "engineering note: camera geometry, focal length and coordinates are deliberately NOT written " +
        "as parametrized numbers (official guidance); they are carried by the exported composition/" +
        "movement reference images and shot-state.json in this package",
    ];

    const shot = [
      `画面: 单镜头，画幅 ${spec.aspectRatio}，时长约 ${formatNumber(spec.movement.durationSeconds)} 秒`,
      `Shot 1: ${MOVEMENT_DESCRIPTIONS[spec.movement.type]}`,
      `主体: ${spec.characters
        .map(
          (character) => `${character.id === "character_a" ? "角色A" : "角色B"}（${character.id}）`,
        )
        .join(" 与 ")}，双人对话场景（${spec.scene.presetId}）`,
    ];

    const semantics = this.config.ordering.map(
      (category: SemanticCategory) => `${category}: ${spec.semantics[category].join("; ")}`,
    );

    return [...header, "", ...shot, "", ...semantics].join("\n");
  }
}

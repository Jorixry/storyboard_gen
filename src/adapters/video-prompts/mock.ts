import type { CompiledPrompt, NormalizedShotSpec, VideoPromptAdapter } from "./types";

/**
 * Deterministic mock video-prompt adapter.
 *
 * Constraints (Prompt 1):
 * - no network access, credentials or paid APIs;
 * - output is a pure function of the normalized input;
 * - it is a placeholder pipeline, not the full compiler from Prompt 6.
 */

export const MOCK_PROMPT_ADAPTER_ID = "mock-video-prompt";
export const MOCK_PROMPT_ADAPTER_VERSION = "0.1.0";

const MOVEMENT_LABELS: Record<NormalizedShotSpec["movementType"], string> = {
  static: "static camera",
  dolly_in: "slow dolly in",
  dolly_out: "slow dolly out",
  truck_left: "truck left",
  truck_right: "truck right",
};

const SUBJECT_LABELS: Record<NormalizedShotSpec["primarySubject"], string> = {
  character_a: "character A as the primary subject",
  character_b: "character B as the primary subject",
  both: "both characters equally framed",
};

export class MockVideoPromptAdapter implements VideoPromptAdapter {
  readonly id = MOCK_PROMPT_ADAPTER_ID;
  readonly version = MOCK_PROMPT_ADAPTER_VERSION;

  async compile(input: NormalizedShotSpec): Promise<CompiledPrompt> {
    const warnings: string[] = [];
    if (input.focalLengthMm <= 0) {
      warnings.push(`invalid focal length: ${input.focalLengthMm}mm`);
    }
    const prompt = [
      `[mock:${this.id}@${this.version}]`,
      `template=${input.templateId}@v${input.templateVersion}`,
      `aspect=${input.aspectRatio}`,
      `focal=${input.focalLengthMm}mm`,
      `movement=${MOVEMENT_LABELS[input.movementType]}`,
      SUBJECT_LABELS[input.primarySubject],
    ].join(" ");
    return { adapterId: this.id, adapterVersion: this.version, prompt, warnings };
  }
}

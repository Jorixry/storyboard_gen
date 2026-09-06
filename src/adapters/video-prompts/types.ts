/**
 * Adapter boundary for external video-model prompt compilation.
 *
 * The full normalized-semantics pipeline and production provider adapters are
 * later prompts. This interface fixes the module boundary now so UI code never
 * depends on provider specifics.
 */

/**
 * Minimal, model-independent semantic subset used by the Prompt 1 mock.
 * Prompt 2/6 will replace this with the full normalized shot specification.
 */
export interface NormalizedShotSpec {
  templateId: string;
  templateVersion: number;
  aspectRatio: "9:16" | "16:9";
  focalLengthMm: number;
  movementType: "static" | "dolly_in" | "dolly_out" | "truck_left" | "truck_right";
  primarySubject: "character_a" | "character_b" | "both";
}

export interface CompiledPrompt {
  /** Adapter identifier, e.g. "mock-video-prompt". */
  adapterId: string;
  adapterVersion: string;
  /** Final prompt text for the target model. */
  prompt: string;
  /** Structured warnings for unsupported or conflicting facts. */
  warnings: string[];
}

export interface VideoPromptAdapter {
  readonly id: string;
  readonly version: string;
  compile(input: NormalizedShotSpec): Promise<CompiledPrompt>;
}

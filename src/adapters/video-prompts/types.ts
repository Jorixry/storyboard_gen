/**
 * Adapter boundary for external video-model prompt compilation.
 *
 * Prompt 6 evolution of the Prompt 1 placeholder: the normalized input is now
 * the full model-independent shot specification (single Zod-defined type in
 * src/domain/prompt-normalization.ts, re-exported here), and every compiled
 * result carries traceable adapter + source metadata. UI code never depends on
 * provider specifics — it goes through a VideoPromptAdapter only.
 */
import type { NormalizedShotSpec } from "@/domain/prompt-normalization";

/**
 * The full normalized shot specification. Defined once (Zod-inferred) in the
 * domain layer; re-exported here because it is the adapter-boundary contract.
 */
export type { NormalizedShotSpec } from "@/domain/prompt-normalization";

/** Traceability: which canonical state and template produced this prompt. */
export interface CompiledPromptSource {
  /** ID of the canonical ShotState the prompt was derived from. */
  shotStateId: string;
  /** schemaVersion of that ShotState. */
  shotStateSchemaVersion: number;
  templateId: string;
  templateVersion: number;
  templateReviewStatus: string;
}

export interface CompiledPrompt {
  /** Adapter identifier, e.g. "generic_video". */
  adapterId: string;
  adapterVersion: string;
  /** Version of the versioned adapter-content config actually used. */
  adapterConfigVersion: number;
  /** Final prompt text for the target model. */
  prompt: string;
  /**
   * Structured warnings for unsupported, unverifiable or conflicting facts,
   * in deterministic emission order (same input => same warnings, same order).
   */
  warnings: string[];
  source: CompiledPromptSource;
}

export interface VideoPromptAdapter {
  readonly id: string;
  readonly version: string;
  compile(input: NormalizedShotSpec): Promise<CompiledPrompt>;
}

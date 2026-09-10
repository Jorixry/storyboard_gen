/**
 * Adapter boundary for external video-model prompt compilation.
 *
 * Prompt 6 moved the full model-independent specification into the domain
 * layer (`src/domain/normalized-spec.ts`); adapters consume that type so the
 * pipeline stays ShotState -> NormalizedShotSpec -> adapter, with no
 * provider-specific shape leaking into the domain.
 */

import type { NormalizedShotSpec } from "@/domain/normalized-spec";

export type { NormalizedShotSpec };

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

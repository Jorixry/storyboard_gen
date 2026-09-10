/**
 * Callable prompt-compilation entry (Prompt 6 / Phase 2 §2.1).
 *
 * Completes the deterministic, model-independent pipeline:
 *
 *   schema-validated ShotState
 *     -> normalizeShotState (canonical schema gate; rejects invalid input)
 *     -> VideoPromptAdapter (e.g. the local GenericVideoPromptAdapter)
 *     -> prompt + warnings + adapter/source metadata
 *
 * Read-only by contract: the state, its template and the store are never
 * mutated, and nothing compiled here is written back into the canonical
 * ShotState or localStorage — prompts are derived artifacts only.
 */
import type { VideoPromptAdapter, CompiledPrompt } from "@/adapters/video-prompts/types";
import { normalizeShotState } from "@/domain/prompt-normalization";
import type { ShotState } from "@/domain/shot-state";

export async function compileVideoPrompt(
  state: ShotState,
  adapter: VideoPromptAdapter,
): Promise<CompiledPrompt> {
  return adapter.compile(normalizeShotState(state));
}

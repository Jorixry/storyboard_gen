/**
 * Adapter boundary for external image-generation providers.
 *
 * Provider implementations must live behind this interface and must never be
 * called directly from UI components. The deterministic mock is the default
 * adapter; the D027 production providers (Seedream primary, Wanxiang backup,
 * single-active) implement the same boundary.
 */

export interface ImageGenerationInput {
  /** Raw composition frame rendered from the canonical 3D scene state. */
  compositionImage: Blob;
  /** Optional 2D character reference images. */
  characterReferences?: Blob[];
  /** Optional style reference image. */
  styleReference?: Blob;
  /** Structured prompt derived from the canonical shot state. */
  prompt: string;
}

export interface GeneratedImageArtifact {
  /** Adapter identifier, e.g. "mock-image-generation". */
  adapterId: string;
  /** Adapter version string. */
  adapterVersion: string;
  /** Generated image bytes. Mocks return deterministic synthetic data. */
  image: Blob;
  /** Deterministic metadata recorded in the artifact manifest. */
  metadata: Record<string, string>;
}

/**
 * Cross-cutting cancellation context for one generation (acceptance fix round
 * 2026-09-23): the /api/enhanced-frame handler arms ONE total deadline and
 * aborts it when the budget expires. Adapters must forward `signal` to every
 * request they make (generation POST, response read, result-image download)
 * and treat `deadlineAt` as an upper bound for any per-attempt budget.
 */
export interface ImageGenerationContext {
  /** Fires when the total generation budget expires (reason: the budget error). */
  signal?: AbortSignal;
  /** Epoch-ms deadline matching the signal; caps per-attempt budgets. */
  deadlineAt?: number;
}

export interface ImageGenerationAdapter {
  readonly id: string;
  readonly version: string;
  generate(
    input: ImageGenerationInput,
    context?: ImageGenerationContext,
  ): Promise<GeneratedImageArtifact>;
}

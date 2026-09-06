/**
 * Adapter boundary for external image-generation providers.
 *
 * Provider implementations must live behind this interface and must never be
 * called directly from UI components. The MVP ships a deterministic mock only;
 * production providers are added in a later prompt after the provider spike.
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

export interface ImageGenerationAdapter {
  readonly id: string;
  readonly version: string;
  generate(input: ImageGenerationInput): Promise<GeneratedImageArtifact>;
}

/**
 * Server-side image-adapter selection (Prompt 7B1 / Phase 2 Day 8 fallback:
 * finish the mock path and failure handling).
 *
 * D027 contract: exactly ONE image provider is active at any time, chosen by
 * the server-side IMAGE_PROVIDER setting — "mock" (default when unset),
 * "seedream" or "wanxiang". No automatic failover, no fan-out, no
 * multi-provider UI. Production adapters arrive in Prompt 7B2; until they are
 * registered here, selecting one is an explicit, structured 501 — never a
 * silent fall-back to the mock, so nobody mistakes mock output for provider
 * output.
 *
 * Pure module: no Next.js imports, no filesystem, no process.env reads (the
 * caller passes the setting in; tests inject their own).
 */
import { MockImageGenerationAdapter } from "@/adapters/image-generation/mock";
import type { ImageGenerationAdapter } from "@/adapters/image-generation/types";

/** Provider ids accepted by the IMAGE_PROVIDER setting (D027). */
export const IMAGE_PROVIDER_IDS = ["mock", "seedream", "wanxiang"] as const;
export type ImageProviderId = (typeof IMAGE_PROVIDER_IDS)[number];

/** A production provider was selected, but its adapter is not implemented yet. */
export class ProviderAdapterNotImplementedError extends Error {
  constructor(public readonly provider: Exclude<ImageProviderId, "mock">) {
    super(
      `IMAGE_PROVIDER="${provider}" was requested, but its production adapter is not implemented yet ` +
        "(arrives in Prompt 7B2); no silent mock fall-back is performed",
    );
    this.name = "ProviderAdapterNotImplementedError";
  }
}

/** IMAGE_PROVIDER holds a value outside the accepted set — server misconfiguration. */
export class UnsupportedImageProviderError extends Error {
  constructor(public readonly value: string) {
    super(
      `IMAGE_PROVIDER must be one of ${IMAGE_PROVIDER_IDS.join(" | ")} (or unset for "mock"); got "${value}"`,
    );
    this.name = "UnsupportedImageProviderError";
  }
}

/**
 * Production adapters register here (Prompt 7B2). The registry is injected so
 * selection stays a pure function of (setting, registry) and tests can prove
 * the 7B1 contract without any provider code.
 */
export interface ImageAdapterRegistry {
  seedream?: ImageGenerationAdapter;
  wanxiang?: ImageGenerationAdapter;
}

export interface SelectedImageAdapter {
  adapter: ImageGenerationAdapter;
  provider: ImageProviderId;
}

/** Normalizes the raw setting: unset/blank -> "mock"; throws on unknown values. */
export function normalizeImageProvider(providerSetting: string | undefined): ImageProviderId {
  const trimmed = (providerSetting ?? "").trim();
  if (trimmed === "" || trimmed === "mock") {
    return "mock";
  }
  if ((IMAGE_PROVIDER_IDS as readonly string[]).includes(trimmed)) {
    return trimmed as ImageProviderId;
  }
  throw new UnsupportedImageProviderError(trimmed);
}

export function selectImageGenerationAdapter(
  providerSetting: string | undefined,
  registry: ImageAdapterRegistry,
): SelectedImageAdapter {
  const provider = normalizeImageProvider(providerSetting);
  if (provider === "mock") {
    return { adapter: new MockImageGenerationAdapter(), provider };
  }
  const registered = registry[provider];
  if (registered === undefined) {
    throw new ProviderAdapterNotImplementedError(provider);
  }
  return { adapter: registered, provider };
}

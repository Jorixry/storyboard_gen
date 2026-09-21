/**
 * Production-adapter registry construction (Prompt 7B2).
 *
 * Pure function of the server-side environment values (which the route passes
 * in; tests inject their own). A production adapter registers ONLY when its
 * credential is present and non-blank — so the D027 single-active switch can
 * never silently route to an adapter that would send an unauthenticated
 * request. The mock is NOT registered here: it is the built-in default of
 * selectImageGenerationAdapter and needs no credential.
 *
 * Optional provider specifics stay overridable through the same env surface
 * (DASHSCOPE_BASE_URL for workspace-dedicated domains); nothing here reads
 * process.env itself.
 */
import { SeedreamImageGenerationAdapter } from "@/adapters/image-generation/seedream";
import { WanxiangImageGenerationAdapter } from "@/adapters/image-generation/wanxiang";

import type { ImageAdapterRegistry } from "./adapter-selection";

export interface ProductionAdapterEnv {
  arkApiKey?: string;
  dashscopeApiKey?: string;
  dashscopeBaseUrl?: string;
}

/** Server-side env var each production provider's credential lives in. */
export const PROVIDER_CREDENTIAL_ENV_VARS: Record<"seedream" | "wanxiang", string> = {
  seedream: "ARK_API_KEY",
  wanxiang: "DASHSCOPE_API_KEY",
};

function hasCredential(value: string | undefined): boolean {
  return (value ?? "").trim() !== "";
}

export function providerCredentialPresent(
  provider: "seedream" | "wanxiang",
  env: ProductionAdapterEnv,
): boolean {
  return hasCredential(provider === "seedream" ? env.arkApiKey : env.dashscopeApiKey);
}

export function buildImageAdapterRegistry(env: ProductionAdapterEnv): ImageAdapterRegistry {
  const registry: ImageAdapterRegistry = {};
  if (hasCredential(env.arkApiKey)) {
    registry.seedream = new SeedreamImageGenerationAdapter({ apiKey: env.arkApiKey!.trim() });
  }
  if (hasCredential(env.dashscopeApiKey)) {
    registry.wanxiang = new WanxiangImageGenerationAdapter({
      apiKey: env.dashscopeApiKey!.trim(),
      ...(hasCredential(env.dashscopeBaseUrl) ? { baseUrl: env.dashscopeBaseUrl!.trim() } : {}),
    });
  }
  return registry;
}

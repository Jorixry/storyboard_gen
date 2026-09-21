import { describe, expect, it } from "vitest";

import {
  buildImageAdapterRegistry,
  PROVIDER_CREDENTIAL_ENV_VARS,
} from "../../src/features/enhanced-frame/registry";

describe("buildImageAdapterRegistry (D027 credential gating)", () => {
  it("registers nothing without credentials — production selection then fails closed", () => {
    const registry = buildImageAdapterRegistry({});
    expect(registry).toEqual({});
  });

  it("blank/whitespace credentials register nothing", () => {
    const registry = buildImageAdapterRegistry({ arkApiKey: "   ", dashscopeApiKey: "" });
    expect(registry.seedream).toBeUndefined();
    expect(registry.wanxiang).toBeUndefined();
  });

  it("registers seedream when ARK_API_KEY is present", () => {
    const registry = buildImageAdapterRegistry({ arkApiKey: "test-key" });
    expect(registry.seedream?.id).toBe("seedream");
    expect(registry.wanxiang).toBeUndefined();
  });

  it("registers wanxiang with the workspace-domain override when provided", () => {
    const registry = buildImageAdapterRegistry({
      dashscopeApiKey: "test-key",
      dashscopeBaseUrl: "https://ws-1.cn-beijing.maas.aliyuncs.com",
    });
    expect(registry.wanxiang?.id).toBe("wanxiang");
    expect(registry.seedream).toBeUndefined();
  });

  it("registers both providers independently when both keys exist", () => {
    const registry = buildImageAdapterRegistry({
      arkApiKey: "a",
      dashscopeApiKey: "b",
    });
    expect(registry.seedream?.id).toBe("seedream");
    expect(registry.wanxiang?.id).toBe("wanxiang");
  });

  it("documents one env var per production provider", () => {
    expect(PROVIDER_CREDENTIAL_ENV_VARS).toEqual({
      seedream: "ARK_API_KEY",
      wanxiang: "DASHSCOPE_API_KEY",
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  ProviderUrlError,
  assertAllowedProviderUrl,
  isPrivateOrReservedHost,
} from "../../src/adapters/image-generation/provider-http";

/**
 * Literal outbound-URL policy tests (acceptance fix round 2, 2026-10-02).
 * Everything here is pure string/URL classification — zero network, and no
 * DNS resolution is claimed or performed. Two regressions are pinned:
 * (R2-2a) hostnames are classified with net.isIP BEFORE any range rule, so an
 * ordinary DNS name like fd-cdn.example.com is not misread as unique-local
 * IPv6; (R2-2b) the WHATWG URL serializer rewrites an IPv4-mapped IPv6 host
 * to hex (`http://[::ffff:127.0.0.1]/` → hostname `[::ffff:7f00:1]`), so
 * mapped loopback/private literals must be recognized in BOTH spellings.
 */

describe("assertAllowedProviderUrl literal host classification (R2-2)", () => {
  it("allows ordinary DNS names whose labels start with IPv6-looking prefixes", () => {
    // Regression: the pre-fix prefix check rejected these as private IPv6.
    expect(() => assertAllowedProviderUrl("https://fd-cdn.example.com/frame.png")).not.toThrow();
    expect(() => assertAllowedProviderUrl("https://fc-cdn.example.com/frame.png")).not.toThrow();
    expect(() => assertAllowedProviderUrl("https://fe80-cdn.example.com/frame.png")).not.toThrow();
    expect(() => assertAllowedProviderUrl("https://api.example.test/v3/images")).not.toThrow();
  });

  it("allows public IP literals in both families, including a mapped public IPv4", () => {
    expect(() => assertAllowedProviderUrl("https://8.8.8.8/generate")).not.toThrow();
    expect(() => assertAllowedProviderUrl("http://[2001:db8::1]/")).not.toThrow();
    expect(() => assertAllowedProviderUrl("http://[2606:4700::1111]/")).not.toThrow();
    // Dotted and URL-normalized hex spellings of the same public mapping.
    expect(() => assertAllowedProviderUrl("http://[::ffff:8.8.8.8]/")).not.toThrow();
    expect(() => assertAllowedProviderUrl("http://[::ffff:808:808]/")).not.toThrow();
  });

  it("keeps refusing localhost-style names and native private/reserved IPv4", () => {
    for (const url of [
      "http://localhost:3000/x",
      "http://host.localhost/x",
      "http://printer.local/x",
      "http://db.internal/x",
      "http://127.0.0.1/x",
      "http://0.0.0.0/x",
      "http://10.0.0.1/x",
      "http://100.64.0.7/x",
      "http://169.254.169.254/latest/meta-data",
      "http://172.16.0.9/x",
      "http://172.31.255.1/x",
      "http://192.168.1.4/x",
      "http://198.18.0.2/x",
    ]) {
      expect(() => assertAllowedProviderUrl(url)).toThrow(ProviderUrlError);
    }
  });

  it("refuses native IPv6 loopback, unspecified, unique-local and link-local literals", () => {
    for (const url of [
      "http://[::1]/",
      "http://[::]/",
      "http://[fd00::1]/",
      "http://[fc00::1]/",
      "http://[fe80::1]/",
      "http://[febf::1]/",
    ]) {
      expect(() => assertAllowedProviderUrl(url)).toThrow(ProviderUrlError);
    }
  });

  it("refuses IPv4-mapped loopback and private in BOTH dotted and URL-normalized hex form", () => {
    // `new URL` normalizes these hosts to the hex spelling on the same line.
    expect(() => assertAllowedProviderUrl("http://[::ffff:127.0.0.1]/")).toThrow(ProviderUrlError);
    expect(() => assertAllowedProviderUrl("http://[::ffff:7f00:1]/")).toThrow(ProviderUrlError);
    expect(() => assertAllowedProviderUrl("http://[::ffff:192.168.1.1]/x")).toThrow(
      ProviderUrlError,
    );
    expect(() => assertAllowedProviderUrl("http://[::ffff:c0a8:101]/x")).toThrow(ProviderUrlError);
    expect(() => assertAllowedProviderUrl("http://[::ffff:10.0.0.2]/")).toThrow(ProviderUrlError);
    expect(() => assertAllowedProviderUrl("http://[::ffff:169.254.0.9]/")).toThrow(
      ProviderUrlError,
    );
  });

  it("refuses the deprecated IPv4-compatible and NAT64 spellings of loopback/private", () => {
    // http://[::127.0.0.1]/ serializes its hostname as [::7f00:1]; the NAT64
    // well-known prefix embeds an IPv4 the same way.
    expect(() => assertAllowedProviderUrl("http://[::127.0.0.1]/")).toThrow(ProviderUrlError);
    expect(() => assertAllowedProviderUrl("http://[::7f00:1]/")).toThrow(ProviderUrlError);
    expect(() => assertAllowedProviderUrl("http://[64:ff9b::127.0.0.1]/")).toThrow(
      ProviderUrlError,
    );
    expect(() => assertAllowedProviderUrl("http://[64:ff9b::7f00:1]/")).toThrow(ProviderUrlError);
    expect(() => assertAllowedProviderUrl("http://[64:ff9b::192.168.1.1]/")).toThrow(
      ProviderUrlError,
    );
    expect(() => assertAllowedProviderUrl("http://[64:ff9b::c0a8:101]/")).toThrow(ProviderUrlError);
    // A NAT64-embedded PUBLIC address is not private/reserved and stays allowed.
    expect(() => assertAllowedProviderUrl("http://[64:ff9b::8.8.8.8]/")).not.toThrow();
  });

  it("refuses non-http(s) schemes, embedded credentials and zone IDs", () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.test/x",
      "https://user:pass@example.test/",
    ]) {
      expect(() => assertAllowedProviderUrl(url)).toThrow(ProviderUrlError);
    }
    // A link-local target with a zone ID: URL serializes the zone as %25.
    expect(() => assertAllowedProviderUrl("http://[fe80::1%25eth0]/")).toThrow(ProviderUrlError);
    expect(() => assertAllowedProviderUrl("http://fe80::1%25eth0/")).toThrow(ProviderUrlError);
  });
});

describe("isPrivateOrReservedHost direct classification (R2-2)", () => {
  it("classifies DNS names, IPv4 and IPv6 separately instead of by prefix", () => {
    // DNS names that merely start with IPv6-looking labels.
    expect(isPrivateOrReservedHost("fd-cdn.example.com")).toBe(false);
    expect(isPrivateOrReservedHost("fc-cdn.example.com")).toBe(false);
    expect(isPrivateOrReservedHost("fe80-cdn.example.com")).toBe(false);
    // Public literals.
    expect(isPrivateOrReservedHost("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedHost("2001:db8::1")).toBe(false);
    expect(isPrivateOrReservedHost("::ffff:8.8.8.8")).toBe(false);
    // Private/reserved literals, bracketed the way URL hostname presents them.
    expect(isPrivateOrReservedHost("localhost")).toBe(true);
    expect(isPrivateOrReservedHost("[::1]")).toBe(true);
    expect(isPrivateOrReservedHost("[fd00::1]")).toBe(true);
    expect(isPrivateOrReservedHost("[fe80::1]")).toBe(true);
    expect(isPrivateOrReservedHost("[::ffff:7f00:1]")).toBe(true);
    expect(isPrivateOrReservedHost("[::ffff:127.0.0.1]")).toBe(true);
    expect(isPrivateOrReservedHost("[64:ff9b::c0a8:101]")).toBe(true);
  });

  it("refuses numeric-but-invalid hosts rather than treating them as DNS names", () => {
    expect(isPrivateOrReservedHost("999.1.1.1")).toBe(true);
    expect(isPrivateOrReservedHost("1.2.3.4.5")).toBe(true);
  });
});

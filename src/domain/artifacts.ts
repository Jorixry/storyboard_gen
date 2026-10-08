/**
 * Raw-export artifact contract (Prompt 5 / Phase 1 Day 5; strict executable
 * manifest schema added in the Prompt 5 fix round).
 *
 * The raw export package is exactly five files (docs/PRODUCT_SPEC.md minus
 * the Phase 2 prompt/enhanced-frame artifacts):
 *
 *   shot-state.json  composition-raw.png  movement-start.png
 *   movement-end.png  manifest.json
 *
 * The manifest is versioned and records the template/schema versions plus a
 * SHA-256 for every non-manifest file, so a reviewer can verify that all
 * artifacts came from the same frozen ShotState snapshot. Beyond the
 * TypeScript type, `rawExportManifestSchema` is the EXECUTABLE truth: the
 * type is derived from it (z.infer — one structural truth, not two), the
 * package builder validates the manifest against it before wrapping the
 * archive, and the browser test re-validates the manifest extracted from the
 * actually downloaded ZIP.
 *
 * Hashes use the WebCrypto SubtleCrypto digest (available in latest Chrome
 * and in Node >= 18) — no dependency, no network. The caller injects
 * `generatedAt`, keeping the whole package byte-deterministic for one
 * snapshot + one timestamp.
 *
 * Framework-independent by contract: no React/Next/Three.js/provider imports.
 */
import { z } from "zod";

import type { ShotState } from "./shot-state";
import { SHOT_STATE_SCHEMA_VERSION } from "./shot-state";
import { aspectRatioSchema, easingSchema, movementTypeSchema } from "./schemas";
import { reviewStatusSchema, templateIdSchema } from "./shot-template";

export const RAW_EXPORT_MANIFEST_VERSION = 1;

/** Exact filenames inside the raw ZIP; the archive contains nothing else. */
export const RAW_EXPORT_FILENAMES = {
  shotState: "shot-state.json",
  compositionRaw: "composition-raw.png",
  movementStart: "movement-start.png",
  movementEnd: "movement-end.png",
  manifest: "manifest.json",
} as const;

export type RawExportFilename = (typeof RAW_EXPORT_FILENAMES)[keyof typeof RAW_EXPORT_FILENAMES];

/** The four hashed artifacts; manifest.json describes itself via manifestVersion. */
export type RawExportArtifactRole = Extract<
  RawExportFilename,
  "shot-state.json" | "composition-raw.png" | "movement-start.png" | "movement-end.png"
>;

const ARTIFACT_ROLES: readonly RawExportArtifactRole[] = [
  RAW_EXPORT_FILENAMES.shotState,
  RAW_EXPORT_FILENAMES.compositionRaw,
  RAW_EXPORT_FILENAMES.movementStart,
  RAW_EXPORT_FILENAMES.movementEnd,
];

/**
 * ISO 8601 UTC timestamp with a mandatory Z suffix — exactly what
 * `Date.toISOString()` emits. Zod's strict ISO datetime validator enforces
 * real calendar semantics (month 01-12, valid day-of-month including
 * leap-year February, hour <= 23, minute/second <= 59), which a plain
 * `\d{2}` regex cannot: it previously accepted 2026-99-99T99:99:99Z and
 * 2026-02-30T12:00:00Z. No offsets are permitted (UTC only).
 */
const iso8601UtcSchema = z.iso.datetime({
  message: "generatedAt must be an ISO 8601 UTC timestamp ending in Z",
});

/** Lowercase 64-hex-digit SHA-256 digest. */
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

const manifestArtifactSchema = z.strictObject({
  name: z.enum(ARTIFACT_ROLES),
  sha256: z.string().regex(SHA256_HEX_REGEX, {
    message: "sha256 must be a lowercase 64-hex-digit digest",
  }),
  bytes: z.number().int().nonnegative(),
});

const manifestFilesSchema = z.array(manifestArtifactSchema).superRefine((files, ctx) => {
  const expected = [...ARTIFACT_ROLES].sort();
  const actual = files.map((file) => file.name).sort();
  const duplicates = actual.filter((name, index) => actual.indexOf(name) !== index);
  if (duplicates.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: [],
      message: `manifest files must not repeat entries; duplicated: ${[...new Set(duplicates)].join(", ")}`,
    });
    return;
  }
  const missing = expected.filter((name) => !actual.includes(name));
  const extra = actual.filter((name) => !expected.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: [],
      message:
        `manifest files must cover exactly the four raw-export artifacts; ` +
        `missing: ${missing.length > 0 ? missing.join(", ") : "none"}; ` +
        `unexpected: ${extra.length > 0 ? extra.join(", ") : "none"}`,
    });
  }
});

/**
 * Executable, versioned, strict manifest schema: rejects unknown fields,
 * wrong kinds/versions, malformed timestamps, invalid digests, non-integer
 * byte counts and any files-list that is not exactly the four hashed
 * artifacts (each once).
 */
export const rawExportManifestSchema = z.strictObject({
  kind: z.literal("storyboard-director-raw-export"),
  manifestVersion: z.literal(RAW_EXPORT_MANIFEST_VERSION),
  /** ISO 8601 UTC timestamp injected by the caller (strict calendar-valid). */
  generatedAt: iso8601UtcSchema,
  shotState: z.strictObject({
    id: z.string().min(1),
    schemaVersion: z.literal(SHOT_STATE_SCHEMA_VERSION),
    template: z.strictObject({
      id: templateIdSchema,
      version: z.number().int().min(1),
      reviewStatus: reviewStatusSchema,
    }),
    aspectRatio: aspectRatioSchema,
  }),
  movement: z.strictObject({
    type: movementTypeSchema,
    durationSeconds: z.number().finite().min(0.5).max(20),
    easing: easingSchema,
  }),
  files: manifestFilesSchema,
});

export type RawExportManifest = z.infer<typeof rawExportManifestSchema>;

/* ------------------------------------------------------------------------- */
/* Full export package (Prompt 8 / Phase 2 §2.3 + Phase 3 Day 9)             */
/* ------------------------------------------------------------------------- */

export const FULL_EXPORT_MANIFEST_VERSION = 2;

/**
 * Exact filenames inside the FULL input package (the MVP_SCOPE "Outputs"
 * bundle). Everything the raw export carries, plus both compiled prompts and
 * an optional enhanced first frame whose extension follows the artifact's
 * actual MIME type (mock results are SVG; provider results are raster).
 */
export const FULL_EXPORT_FILENAMES = {
  shotState: "shot-state.json",
  compositionRaw: "composition-raw.png",
  movementStart: "movement-start.png",
  movementEnd: "movement-end.png",
  promptGeneric: "prompt-generic.txt",
  promptTarget: "prompt-seedance.txt",
  enhancedFirstFrameBases: [
    "enhanced-first-frame.png",
    "enhanced-first-frame.svg",
    "enhanced-first-frame.jpeg",
    "enhanced-first-frame.webp",
  ] as const,
  manifest: "manifest.json",
} as const;

/** Every file name the full package may contain (manifest.json excluded). */
export const FULL_EXPORT_ARTIFACT_NAMES = [
  "shot-state.json",
  "composition-raw.png",
  "movement-start.png",
  "movement-end.png",
  "prompt-generic.txt",
  "prompt-seedance.txt",
  ...FULL_EXPORT_FILENAMES.enhancedFirstFrameBases,
] as const;

export type FullExportArtifactName = (typeof FULL_EXPORT_ARTIFACT_NAMES)[number];

const FULL_PROMPT_FILENAMES = z.enum(["prompt-generic.txt", "prompt-seedance.txt"]);
const FULL_ENHANCED_FILENAMES = z.enum(FULL_EXPORT_FILENAMES.enhancedFirstFrameBases);

const fullManifestArtifactSchema = z.strictObject({
  name: z.enum(FULL_EXPORT_ARTIFACT_NAMES),
  sha256: z.string().regex(SHA256_HEX_REGEX, {
    message: "sha256 must be a lowercase 64-hex-digit digest",
  }),
  bytes: z.number().int().nonnegative(),
});

/** Adapter identity triple shared by the prompt and enhanced-frame records. */
const adapterRefSchema = z.strictObject({
  adapterId: z.string().min(1),
  adapterVersion: z.string().min(1),
  adapterConfigVersion: z.number().int().min(1).optional(),
});

const fullManifestFilesSchema = z.array(fullManifestArtifactSchema).superRefine((files, ctx) => {
  const required: readonly string[] = [
    "shot-state.json",
    "composition-raw.png",
    "movement-start.png",
    "movement-end.png",
    "prompt-generic.txt",
    "prompt-seedance.txt",
  ];
  const names: string[] = files.map((file) => file.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: [],
      message: `manifest files must not repeat entries; duplicated: ${[...new Set(duplicates)].join(", ")}`,
    });
    return;
  }
  const enhanced = names.filter((name) =>
    (FULL_EXPORT_FILENAMES.enhancedFirstFrameBases as readonly string[]).includes(name),
  );
  if (enhanced.length > 1) {
    ctx.addIssue({
      code: "custom",
      path: [],
      message: `at most one enhanced-first-frame file may appear; found: ${enhanced.join(", ")}`,
    });
    return;
  }
  const missing = required.filter((name) => !names.includes(name));
  const extra = names.filter(
    (name) =>
      !required.includes(name) &&
      !(FULL_EXPORT_FILENAMES.enhancedFirstFrameBases as readonly string[]).includes(name),
  );
  if (missing.length > 0 || extra.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: [],
      message:
        `manifest files must be exactly the six required artifacts plus at most one enhanced ` +
        `first frame; missing: ${missing.length > 0 ? missing.join(", ") : "none"}; ` +
        `unexpected: ${extra.length > 0 ? extra.join(", ") : "none"}`,
    });
  }
});

/**
 * Executable, versioned, strict manifest schema for the FULL input package.
 * Beyond the raw manifest it records BOTH prompt adapters and the enhanced
 * frame's provenance, so a reviewer can verify every artifact points at the
 * same state/template/adapter versions without opening the files.
 */
export const fullExportManifestSchema = z.strictObject({
  kind: z.literal("storyboard-director-full-export"),
  manifestVersion: z.literal(FULL_EXPORT_MANIFEST_VERSION),
  generatedAt: iso8601UtcSchema,
  shotState: z.strictObject({
    id: z.string().min(1),
    schemaVersion: z.literal(SHOT_STATE_SCHEMA_VERSION),
    template: z.strictObject({
      id: templateIdSchema,
      version: z.number().int().min(1),
      reviewStatus: reviewStatusSchema,
    }),
    aspectRatio: aspectRatioSchema,
  }),
  movement: z.strictObject({
    type: movementTypeSchema,
    durationSeconds: z.number().finite().min(0.5).max(20),
    easing: easingSchema,
  }),
  prompts: z.strictObject({
    generic: adapterRefSchema.extend({ fileName: FULL_PROMPT_FILENAMES }),
    target: adapterRefSchema.extend({ fileName: FULL_PROMPT_FILENAMES }),
  }),
  enhancedFrame: z.union([
    z.strictObject({
      included: z.literal(true),
      fileName: FULL_ENHANCED_FILENAMES,
      adapter: adapterRefSchema,
      provider: z.string().min(1),
      /** Canonical fingerprint of the ShotState the frame was generated from. */
      sourceFingerprint: z.string().min(1),
    }),
    z.strictObject({
      included: z.literal(false),
      reason: z.enum(["absent", "stale"]),
    }),
  ]),
  files: fullManifestFilesSchema,
});

export type FullExportManifest = z.infer<typeof fullExportManifestSchema>;

/** Maps an enhanced-frame MIME type to the packaged filename. */
export function enhancedFirstFrameFileName(
  mimeType: string,
): (typeof FULL_EXPORT_FILENAMES.enhancedFirstFrameBases)[number] {
  switch (mimeType) {
    case "image/png":
      return "enhanced-first-frame.png";
    case "image/svg+xml":
      return "enhanced-first-frame.svg";
    case "image/jpeg":
      return "enhanced-first-frame.jpeg";
    case "image/webp":
      return "enhanced-first-frame.webp";
    default:
      throw new Error(`unsupported enhanced-frame mime type "${mimeType}"`);
  }
}

/** Deterministic export raster: long edge 1280 px, dpr 1, aspect-exact. */
export const EXPORT_IMAGE_LONG_EDGE_PX = 1280;

export function exportImageDimensions(aspectRatio: ShotState["aspectRatio"]): {
  width: number;
  height: number;
} {
  return aspectRatio === "16:9"
    ? {
        width: EXPORT_IMAGE_LONG_EDGE_PX,
        height: Math.round((EXPORT_IMAGE_LONG_EDGE_PX * 9) / 16),
      }
    : {
        width: Math.round((EXPORT_IMAGE_LONG_EDGE_PX * 9) / 16),
        height: EXPORT_IMAGE_LONG_EDGE_PX,
      };
}

/** SHA-256 of the exact bytes stored in the archive, lowercase hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Serializes the canonical ShotState for export. Pretty-printed with a fixed
 * two-space indent so the file is reviewable and diffable; the object itself
 * is the exact frozen snapshot the caller validated.
 */
export function serializeShotStateJson(shotState: ShotState): Uint8Array {
  return encodeJson(shotState);
}

/**
 * Builds the versioned manifest for the four hashed artifacts of one frozen
 * ShotState snapshot. The manifest hashes the artifact BYTES the caller will
 * store, so the manifest can never claim a different payload than the ZIP.
 */
export async function buildRawExportManifest(
  shotState: ShotState,
  artifacts: Readonly<Record<RawExportArtifactRole, Uint8Array>>,
  generatedAt: string,
): Promise<{ manifest: RawExportManifest; bytes: Uint8Array }> {
  const files: z.infer<typeof manifestArtifactSchema>[] = [];
  for (const name of ARTIFACT_ROLES) {
    const bytes = artifacts[name];
    files.push({
      name,
      sha256: await sha256Hex(bytes),
      bytes: bytes.byteLength,
    });
  }
  const candidate: RawExportManifest = {
    kind: "storyboard-director-raw-export",
    manifestVersion: RAW_EXPORT_MANIFEST_VERSION,
    generatedAt,
    shotState: {
      id: shotState.id,
      schemaVersion: shotState.schemaVersion,
      template: shotState.template,
      aspectRatio: shotState.aspectRatio,
    },
    movement: {
      type: shotState.movement.type,
      durationSeconds: shotState.movement.durationSeconds,
      easing: shotState.movement.easing,
    },
    files,
  };
  // The builder itself runs the executable schema: a manifest that would not
  // validate can never leave the domain layer.
  const manifest = rawExportManifestSchema.parse(candidate);
  return { manifest, bytes: encodeJson(manifest) };
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

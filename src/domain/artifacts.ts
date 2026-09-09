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

/** ISO 8601 UTC timestamp with mandatory Z suffix (what Date.toISOString emits). */
const ISO_8601_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

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
  /** ISO 8601 UTC timestamp injected by the caller. */
  generatedAt: z.string().regex(ISO_8601_UTC_REGEX, {
    message: "generatedAt must be an ISO 8601 UTC timestamp ending in Z",
  }),
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

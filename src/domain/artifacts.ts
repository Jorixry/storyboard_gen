/**
 * Raw-export artifact contract (Prompt 5 / Phase 1 Day 5).
 *
 * The raw export package is exactly five files (docs/PRODUCT_SPEC.md minus
 * the Phase 2 prompt/enhanced-frame artifacts):
 *
 *   shot-state.json  composition-raw.png  movement-start.png
 *   movement-end.png  manifest.json
 *
 * The manifest is explicitly versioned and records the template/schema
 * versions plus a SHA-256 for every non-manifest file, so a reviewer can
 * verify that all artifacts came from the same frozen ShotState snapshot.
 * Hashes use the WebCrypto SubtleCrypto digest (available in latest Chrome
 * and in Node >= 18) — no dependency, no network.
 *
 * The ShotState itself is serialized here (never in the store or the
 * renderer), and the caller injects `generatedAt`, keeping the whole package
 * byte-deterministic for one snapshot + one timestamp.
 *
 * Framework-independent by contract: no React/Next/Three.js/provider imports.
 */
import type { ShotState } from "./shot-state";

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

export interface RawExportManifest {
  kind: "storyboard-director-raw-export";
  manifestVersion: typeof RAW_EXPORT_MANIFEST_VERSION;
  /** ISO 8601 UTC timestamp injected by the caller. */
  generatedAt: string;
  shotState: {
    id: string;
    schemaVersion: ShotState["schemaVersion"];
    template: ShotState["template"];
    aspectRatio: ShotState["aspectRatio"];
  };
  movement: {
    type: ShotState["movement"]["type"];
    durationSeconds: number;
    easing: ShotState["movement"]["easing"];
  };
  files: Array<{
    name: RawExportArtifactRole;
    sha256: string;
    bytes: number;
  }>;
}

/** Deterministic export raster: long edge 1280 px, dpr 1, aspect-exact. */
export const EXPORT_IMAGE_LONG_EDGE_PX = 1280;

export function exportImageDimensions(aspectRatio: ShotState["aspectRatio"]): {
  width: number;
  height: number;
} {
  return aspectRatio === "16:9"
    ? { width: EXPORT_IMAGE_LONG_EDGE_PX, height: Math.round((EXPORT_IMAGE_LONG_EDGE_PX * 9) / 16) }
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
  const manifest: RawExportManifest = {
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
    files: [],
  };
  for (const name of ARTIFACT_ROLES) {
    const bytes = artifacts[name];
    manifest.files.push({
      name,
      sha256: await sha256Hex(bytes),
      bytes: bytes.byteLength,
    });
  }
  return { manifest, bytes: encodeJson(manifest) };
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

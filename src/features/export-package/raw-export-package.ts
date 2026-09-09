/**
 * Raw export package assembly (Prompt 5 / Phase 1 Day 5).
 *
 * Pure function from (frozen ShotState snapshot, three PNG byte arrays,
 * injected timestamp) to the downloadable ZIP bytes. The caller is
 * responsible for validating/freezing the snapshot exactly once and for
 * capturing the images; this module owns nothing mutable, calls no browser
 * API except WebCrypto hashing, and adds no provider data.
 *
 * Archive layout (exactly five files, in this order):
 *   shot-state.json, composition-raw.png, movement-start.png,
 *   movement-end.png, manifest.json
 *
 * The manifest hashes the exact bytes stored here, so the archive and the
 * manifest can never disagree. Byte-deterministic for one snapshot + one
 * timestamp, which keeps unit tests and future visual regression evidence
 * reproducible.
 */
import {
  buildRawExportManifest,
  RAW_EXPORT_FILENAMES,
  serializeShotStateJson,
  type RawExportArtifactRole,
  type RawExportManifest,
} from "@/domain/artifacts";
import { shotStateSchema, type ShotState } from "@/domain/shot-state";

import { buildStoreZip } from "./zip-store";

export interface RawExportImages {
  compositionRaw: Uint8Array;
  movementStart: Uint8Array;
  movementEnd: Uint8Array;
}

export interface RawExportPackage {
  fileName: string;
  zip: Uint8Array;
  manifest: RawExportManifest;
}

export function rawExportFileName(shotStateId: string): string {
  return `shot-${shotStateId}-raw.zip`;
}

/**
 * Validates the snapshot one final time (the canonical Zod schema is the only
 * gate) and assembles the five-file raw package.
 */
export async function buildRawExportPackage(
  shotState: ShotState,
  images: RawExportImages,
  generatedAt: Date,
): Promise<RawExportPackage> {
  const frozen = shotStateSchema.parse(shotState);
  const artifacts: Record<RawExportArtifactRole, Uint8Array> = {
    [RAW_EXPORT_FILENAMES.shotState]: serializeShotStateJson(frozen),
    [RAW_EXPORT_FILENAMES.compositionRaw]: images.compositionRaw,
    [RAW_EXPORT_FILENAMES.movementStart]: images.movementStart,
    [RAW_EXPORT_FILENAMES.movementEnd]: images.movementEnd,
  };
  const { manifest, bytes: manifestBytes } = await buildRawExportManifest(
    frozen,
    artifacts,
    generatedAt.toISOString(),
  );
  const zip = buildStoreZip(
    [
      { name: RAW_EXPORT_FILENAMES.shotState, data: artifacts[RAW_EXPORT_FILENAMES.shotState] },
      {
        name: RAW_EXPORT_FILENAMES.compositionRaw,
        data: artifacts[RAW_EXPORT_FILENAMES.compositionRaw],
      },
      {
        name: RAW_EXPORT_FILENAMES.movementStart,
        data: artifacts[RAW_EXPORT_FILENAMES.movementStart],
      },
      { name: RAW_EXPORT_FILENAMES.movementEnd, data: artifacts[RAW_EXPORT_FILENAMES.movementEnd] },
      { name: RAW_EXPORT_FILENAMES.manifest, data: manifestBytes },
    ],
    generatedAt,
  );
  return { fileName: rawExportFileName(frozen.id), zip, manifest };
}

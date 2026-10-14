/**
 * Full input-package assembly (Prompt 8 / Phase 2 §2.3 + Phase 3 Day 9).
 *
 * Pure function from one frozen ShotState snapshot, the three raw PNG rasters,
 * BOTH compiled prompts (generic + target-model) and an optional enhanced
 * first frame to the downloadable ZIP bytes. Same discipline as the Prompt 5
 * raw package: the caller validates/freezes the snapshot once and captures
 * the images; this module owns nothing mutable, hashes only WebCrypto, adds
 * no provider data of its own and is byte-deterministic for one snapshot +
 * one timestamp.
 *
 * Same-source verification is EXECUTABLE, not documentary: the builder
 * refuses the package when either prompt was not compiled from THIS frozen
 * state — identity fields PLUS the complete-state fingerprint, because a shot
 * keeps its id/template through ordinary edits (R3, 2026-10-14) — and an
 * enhanced frame whose full-state fingerprint no longer matches is excluded
 * with reason "stale" instead of shipping a frame that no longer describes
 * this state. Both compilers' warnings ride in the manifest next to their
 * prompt records (R4), and the enhanced frame carries its allowlisted
 * generation settings (R1).
 *
 * Archive layout (exactly eight or nine files, in this order):
 *   shot-state.json, composition-raw.png, movement-start.png,
 *   movement-end.png, prompt-generic.txt, prompt-seedance.txt,
 *   template-diff.txt, [enhanced-first-frame.<ext>], manifest.json
 */
import { buildStoreZip, type ZipEntry } from "@/features/export-package/zip-store";
import type { CompiledPrompt } from "@/adapters/video-prompts/types";
import type { ShotTemplate } from "@/domain/shot-template";
import {
  enhancedFirstFrameFileName,
  exportableEnhancedFrameMetadata,
  FULL_EXPORT_FILENAMES,
  FULL_EXPORT_MANIFEST_VERSION,
  fullExportManifestSchema,
  serializeShotStateJson,
  sha256Hex,
  type FullExportManifest,
} from "@/domain/artifacts";
import {
  shotStateFingerprint,
  shotStateSchema,
  withCanonicalCharacterOrder,
  type ShotState,
} from "@/domain/shot-state";

import { buildTemplateDiff } from "./template-diff";

/** The three raw rasters, captured exactly like the Prompt 5 raw export. */
export interface FullExportImages {
  compositionRaw: Uint8Array;
  movementStart: Uint8Array;
  movementEnd: Uint8Array;
}

/** A valid, current enhanced frame offered to the package. */
export interface FullExportEnhancedFrame {
  bytes: Uint8Array;
  mimeType: string;
  adapterId: string;
  adapterVersion: string;
  provider: string;
  /** shotStateFingerprint of the state the frame was generated from. */
  sourceFingerprint: string;
  /**
   * Generation settings returned by the image adapter (the enhanced-frame
   * store keeps them verbatim). The export projects them onto the safe
   * ENHANCED_FRAME_METADATA_KEYS allowlist — see domain/artifacts.ts (R1).
   */
  metadata: Record<string, string>;
}

export interface FullExportPackageInput {
  shotState: ShotState;
  /** Diff baseline: the template this state was created from (id@version must match). */
  template: ShotTemplate;
  images: FullExportImages;
  prompts: {
    generic: CompiledPrompt;
    target: CompiledPrompt;
  };
  enhancedFrame: FullExportEnhancedFrame | { reason: "absent" | "stale" };
  generatedAt: Date;
}

export interface FullExportPackage {
  fileName: string;
  zip: Uint8Array;
  manifest: FullExportManifest;
}

export function fullExportFileName(shotStateId: string): string {
  return `shot-${shotStateId}-full.zip`;
}

function verifyPromptSource(
  role: "generic" | "target",
  prompt: CompiledPrompt,
  frozen: ShotState,
): void {
  const { source } = prompt;
  const problems: string[] = [];
  if (source.shotStateId !== frozen.id) {
    problems.push(`shotStateId ${source.shotStateId} != ${frozen.id}`);
  }
  if (source.shotStateSchemaVersion !== frozen.schemaVersion) {
    problems.push(`schema v${source.shotStateSchemaVersion} != v${frozen.schemaVersion}`);
  }
  // Full-state fingerprint (R3, 2026-10-14): identity fields survive ordinary
  // edits (a shot keeps its id and template while camera/characters/movement/
  // semantics change), so only the complete-content fingerprint proves the
  // prompt was compiled from THIS exact state. The comparison uses the same
  // canonical character order normalization applies, so an order-only
  // difference is not a mismatch.
  if (source.stateFingerprint !== shotStateFingerprint(withCanonicalCharacterOrder(frozen))) {
    problems.push(
      "state fingerprint mismatch (the prompt was compiled from different state content)",
    );
  }
  if (source.templateId !== frozen.template.id) {
    problems.push(`template ${source.templateId} != ${frozen.template.id}`);
  }
  if (source.templateVersion !== frozen.template.version) {
    problems.push(`template v${source.templateVersion} != v${frozen.template.version}`);
  }
  if (source.templateReviewStatus !== frozen.template.reviewStatus) {
    problems.push(
      `review status ${source.templateReviewStatus} != ${frozen.template.reviewStatus}`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `the ${role} prompt was not compiled from this frozen ShotState; the package was refused ` +
        `(${problems.join("; ")})`,
    );
  }
}

/**
 * Assembles the full input package. Validates the snapshot one final time,
 * refuses any prompt not compiled from this exact state, excludes a stale
 * enhanced frame deterministically, then builds and schema-validates the
 * versioned manifest before wrapping the archive (byte-count cross-checks
 * included, mirroring the raw package).
 */
export async function buildFullExportPackage(
  input: FullExportPackageInput,
): Promise<FullExportPackage> {
  const frozen = shotStateSchema.parse(input.shotState);
  verifyPromptSource("generic", input.prompts.generic, frozen);
  verifyPromptSource("target", input.prompts.target, frozen);
  // The diff baseline must be the exact template the state carries; a
  // mismatched baseline would diff against the wrong defaults.
  if (
    input.template.id !== frozen.template.id ||
    input.template.version !== frozen.template.version
  ) {
    throw new Error(
      `template-diff refused: the state carries ${frozen.template.id}@v${frozen.template.version} ` +
        `but the provided baseline is ${input.template.id}@v${input.template.version}`,
    );
  }

  const currentFingerprint = shotStateFingerprint(frozen);
  const offered = "reason" in input.enhancedFrame ? null : input.enhancedFrame;
  const stale =
    offered !== null &&
    (offered.sourceFingerprint !== currentFingerprint || offered.bytes.byteLength === 0);
  const enhanced: FullExportEnhancedFrame | { reason: "absent" | "stale" } =
    offered === null ? input.enhancedFrame : stale ? { reason: "stale" } : offered;
  const includedFrame = "reason" in enhanced ? null : enhanced;

  const artifacts = new Map<string, Uint8Array>();
  artifacts.set(FULL_EXPORT_FILENAMES.shotState, serializeShotStateJson(frozen));
  artifacts.set(FULL_EXPORT_FILENAMES.compositionRaw, input.images.compositionRaw);
  artifacts.set(FULL_EXPORT_FILENAMES.movementStart, input.images.movementStart);
  artifacts.set(FULL_EXPORT_FILENAMES.movementEnd, input.images.movementEnd);
  artifacts.set(
    FULL_EXPORT_FILENAMES.promptGeneric,
    new TextEncoder().encode(input.prompts.generic.prompt),
  );
  artifacts.set(
    FULL_EXPORT_FILENAMES.promptTarget,
    new TextEncoder().encode(input.prompts.target.prompt),
  );
  artifacts.set(
    FULL_EXPORT_FILENAMES.templateDiff,
    new TextEncoder().encode(buildTemplateDiff(frozen, input.template)),
  );
  if (includedFrame !== null) {
    artifacts.set(enhancedFirstFrameFileName(includedFrame.mimeType), includedFrame.bytes);
  }

  const files: FullExportManifest["files"] = [];
  for (const [name, bytes] of artifacts) {
    files.push({
      name: name as FullExportManifest["files"][number]["name"],
      sha256: await sha256Hex(bytes),
      bytes: bytes.byteLength,
    });
  }

  const candidate: FullExportManifest = {
    kind: "storyboard-director-full-export",
    manifestVersion: FULL_EXPORT_MANIFEST_VERSION,
    generatedAt: input.generatedAt.toISOString(),
    shotState: {
      id: frozen.id,
      schemaVersion: frozen.schemaVersion,
      template: frozen.template,
      aspectRatio: frozen.aspectRatio,
    },
    movement: {
      type: frozen.movement.type,
      durationSeconds: frozen.movement.durationSeconds,
      easing: frozen.movement.easing,
    },
    prompts: {
      generic: {
        fileName: FULL_EXPORT_FILENAMES.promptGeneric,
        adapterId: input.prompts.generic.adapterId,
        adapterVersion: input.prompts.generic.adapterVersion,
        adapterConfigVersion: input.prompts.generic.adapterConfigVersion,
        warnings: input.prompts.generic.warnings,
      },
      target: {
        fileName: FULL_EXPORT_FILENAMES.promptTarget,
        adapterId: input.prompts.target.adapterId,
        adapterVersion: input.prompts.target.adapterVersion,
        adapterConfigVersion: input.prompts.target.adapterConfigVersion,
        warnings: input.prompts.target.warnings,
      },
    },
    enhancedFrame:
      includedFrame !== null
        ? {
            included: true,
            fileName: enhancedFirstFrameFileName(includedFrame.mimeType),
            adapter: {
              adapterId: includedFrame.adapterId,
              adapterVersion: includedFrame.adapterVersion,
            },
            provider: includedFrame.provider,
            sourceFingerprint: includedFrame.sourceFingerprint,
            metadata: exportableEnhancedFrameMetadata(includedFrame.metadata),
          }
        : { included: false, reason: "reason" in enhanced ? enhanced.reason : "absent" },
    files,
  };

  const manifest = fullExportManifestSchema.parse(candidate);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  for (const file of manifest.files) {
    if (file.bytes !== artifacts.get(file.name)!.byteLength) {
      throw new Error(
        `manifest byte count for ${file.name} (${file.bytes}) does not match the artifact ` +
          `(${artifacts.get(file.name)!.byteLength}); the package was refused`,
      );
    }
  }

  const entries: ZipEntry[] = [...artifacts.entries()].map(([name, data]) => ({ name, data }));
  entries.push({ name: FULL_EXPORT_FILENAMES.manifest, data: manifestBytes });

  return {
    fileName: fullExportFileName(frozen.id),
    zip: buildStoreZip(entries, input.generatedAt),
    manifest,
  };
}

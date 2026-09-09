import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { RAW_EXPORT_FILENAMES } from "../../src/domain/artifacts";
import {
  SHOT_STATE_SCHEMA_VERSION,
  shotStateSchema,
  type ShotState,
} from "../../src/domain/shot-state";
import {
  buildRawExportPackage,
  rawExportFileName,
  type RawExportImages,
} from "../../src/features/export-package/raw-export-package";
import { readStoreZip } from "../helpers/zip-reader";

/**
 * Raw export package assembly (Prompt 5 / Phase 1 Day 5): the archive must
 * contain exactly the five documented files, in order, whose bytes hash to
 * the manifest claims — verified through the independent test-side ZIP reader
 * and node:crypto.
 */

const GENERATED_AT = new Date("2026-09-09T12:00:00.000Z");

function buildState(): ShotState {
  return shotStateSchema.parse({
    id: "test-shot-0002",
    schemaVersion: SHOT_STATE_SCHEMA_VERSION,
    template: { id: "dialogue_medium_two_shot", version: 1, reviewStatus: "engineering_ready" },
    aspectRatio: "16:9",
    scene: { presetId: "dialogue_room" },
    camera: {
      position: [0, 1.6, 3.4],
      target: [0, 1.55, 0],
      focalLengthMm: 35,
      shotSize: "medium_two_shot",
      safeRanges: { focalLengthMm: [12, 200] },
    },
    characters: [
      { id: "character_a", position: [-0.8, 0, 0], rotationYDeg: 90 },
      { id: "character_b", position: [0.8, 0, 0], rotationYDeg: -90 },
    ],
    movement: {
      type: "static",
      start: { position: [0, 1.6, 3.4], target: [0, 1.55, 0], focalLengthMm: 35 },
      end: { position: [0, 1.6, 3.4], target: [0, 1.55, 0], focalLengthMm: 35 },
      durationSeconds: 4,
      easing: "linear",
    },
    semantics: {
      subjects: ["balanced_two_subjects"],
      composition: ["medium_two_shot"],
      optics: ["focal_35mm"],
      motion: ["static_camera"],
      continuity: ["maintain_axis"],
    },
  });
}

function pngBytes(seed: number): Uint8Array {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return new Uint8Array([
    ...header,
    ...Array.from({ length: 64 }, (_, index) => (index + seed) % 251),
  ]);
}

function images(): RawExportImages {
  return { compositionRaw: pngBytes(1), movementStart: pngBytes(2), movementEnd: pngBytes(3) };
}

describe("rawExportFileName", () => {
  it("derives the deterministic archive name from the ShotState ID", () => {
    expect(rawExportFileName("abc-123")).toBe("shot-abc-123-raw.zip");
  });
});

describe("buildRawExportPackage", () => {
  it("contains exactly the five documented files in the documented order", async () => {
    const pkg = await buildRawExportPackage(buildState(), images(), GENERATED_AT);
    const entries = readStoreZip(Buffer.from(pkg.zip));
    expect(entries.map((entry) => entry.name)).toEqual([
      RAW_EXPORT_FILENAMES.shotState,
      RAW_EXPORT_FILENAMES.compositionRaw,
      RAW_EXPORT_FILENAMES.movementStart,
      RAW_EXPORT_FILENAMES.movementEnd,
      RAW_EXPORT_FILENAMES.manifest,
    ]);
  });

  it("stores the exact canonical ShotState JSON inside the archive", async () => {
    const state = buildState();
    const pkg = await buildRawExportPackage(state, images(), GENERATED_AT);
    const entries = readStoreZip(Buffer.from(pkg.zip));
    const stored = JSON.parse(
      entries.find((entry) => entry.name === RAW_EXPORT_FILENAMES.shotState)!.data.toString("utf8"),
    );
    expect(stored).toEqual(state);
  });

  it("stores a manifest whose hashes match the archived bytes (node:crypto cross-check)", async () => {
    const state = buildState();
    const pkg = await buildRawExportPackage(state, images(), GENERATED_AT);
    const entries = readStoreZip(Buffer.from(pkg.zip));
    const manifest = JSON.parse(
      entries.find((entry) => entry.name === RAW_EXPORT_FILENAMES.manifest)!.data.toString("utf8"),
    );
    expect(manifest.kind).toBe("storyboard-director-raw-export");
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.generatedAt).toBe(GENERATED_AT.toISOString());
    expect(manifest.shotState.id).toBe(state.id);
    expect(manifest.movement.type).toBe("static");
    for (const file of manifest.files) {
      const archived = entries.find((entry) => entry.name === file.name)!.data;
      expect(createHash("sha256").update(archived).digest("hex")).toBe(file.sha256);
      expect(archived.byteLength).toBe(file.bytes);
    }
  });

  it("names the archive deterministically from the snapshot ID", async () => {
    const state = buildState();
    const pkg = await buildRawExportPackage(state, images(), GENERATED_AT);
    expect(pkg.fileName).toBe(`shot-${state.id}-raw.zip`);
  });

  it("is byte-deterministic for one snapshot, image set and timestamp", async () => {
    const state = buildState();
    const first = await buildRawExportPackage(state, images(), GENERATED_AT);
    const second = await buildRawExportPackage(state, images(), GENERATED_AT);
    expect(Buffer.compare(Buffer.from(first.zip), Buffer.from(second.zip))).toBe(0);
  });

  it("refuses schema-invalid snapshots (one-time validation gate)", async () => {
    const corrupted = { ...buildState(), camera: { ...buildState().camera, focalLengthMm: 5000 } };
    await expect(
      buildRawExportPackage(corrupted as unknown as ShotState, images(), GENERATED_AT),
    ).rejects.toThrow();
  });
});

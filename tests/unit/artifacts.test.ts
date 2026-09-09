import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildRawExportManifest,
  exportImageDimensions,
  rawExportManifestSchema,
  RAW_EXPORT_FILENAMES,
  serializeShotStateJson,
  sha256Hex,
  type RawExportArtifactRole,
} from "../../src/domain/artifacts";
import {
  SHOT_STATE_SCHEMA_VERSION,
  shotStateSchema,
  type ShotState,
} from "../../src/domain/shot-state";

/**
 * Raw-export artifact contract (Prompt 5 / Phase 1 Day 5): filenames, export
 * raster dimensions, manifest shape and hash coverage. Hashes are
 * cross-checked against node:crypto — an implementation independent of the
 * WebCrypto call in production code.
 */

const BASE_STATE: ShotState = shotStateSchema.parse({
  id: "test-shot-0001",
  schemaVersion: SHOT_STATE_SCHEMA_VERSION,
  template: { id: "dialogue_ots_a_to_b", version: 1, reviewStatus: "engineering_ready" },
  aspectRatio: "16:9",
  scene: { presetId: "dialogue_room" },
  camera: {
    position: [-1.25, 1.7, 2.0],
    target: [0.8, 1.55, 0.0],
    focalLengthMm: 50,
    shotSize: "medium_close_up",
    safeRanges: { focalLengthMm: [12, 200] },
  },
  characters: [
    { id: "character_a", position: [-0.8, 0, 0], rotationYDeg: 90 },
    { id: "character_b", position: [0.8, 0, 0], rotationYDeg: -90 },
  ],
  movement: {
    type: "dolly_in",
    start: { position: [-1.25, 1.7, 2.0], target: [0.8, 1.55, 0.0], focalLengthMm: 50 },
    end: { position: [-1.05, 1.68, 1.4], target: [0.8, 1.55, 0.0], focalLengthMm: 50 },
    durationSeconds: 4,
    easing: "ease_in_out",
  },
  semantics: {
    subjects: ["character_b_primary"],
    composition: ["over_the_shoulder"],
    optics: ["focal_50mm"],
    motion: ["subtle_dolly_in"],
    continuity: ["maintain_axis"],
  },
});

const GENERATED_AT = "2026-09-09T12:00:00.000Z";

function artifactBytes(): Record<RawExportArtifactRole, Uint8Array> {
  return {
    [RAW_EXPORT_FILENAMES.shotState]: serializeShotStateJson(BASE_STATE),
    [RAW_EXPORT_FILENAMES.compositionRaw]: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    [RAW_EXPORT_FILENAMES.movementStart]: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]),
    [RAW_EXPORT_FILENAMES.movementEnd]: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]),
  };
}

describe("exportImageDimensions", () => {
  it("uses a 1280 px long edge, aspect-exact, for both ratios", () => {
    expect(exportImageDimensions("16:9")).toEqual({ width: 1280, height: 720 });
    expect(exportImageDimensions("9:16")).toEqual({ width: 720, height: 1280 });
  });
});

describe("sha256Hex", () => {
  it("matches the well-known empty-input digest", async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches an independent node:crypto digest for binary input", async () => {
    const bytes = new Uint8Array(Array.from({ length: 256 }, (_, index) => index));
    expect(await sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});

describe("serializeShotStateJson", () => {
  it("round-trips the exact canonical state, pretty-printed", () => {
    const text = new TextDecoder().decode(serializeShotStateJson(BASE_STATE));
    expect(text).toContain("\n  "); // two-space indent for reviewable diffs
    expect(JSON.parse(text)).toEqual(BASE_STATE);
  });
});

describe("buildRawExportManifest", () => {
  it("covers exactly the four hashed artifacts in archive order", async () => {
    const { manifest, bytes } = await buildRawExportManifest(
      BASE_STATE,
      artifactBytes(),
      GENERATED_AT,
    );
    expect(manifest.files.map((file) => file.name)).toEqual([
      RAW_EXPORT_FILENAMES.shotState,
      RAW_EXPORT_FILENAMES.compositionRaw,
      RAW_EXPORT_FILENAMES.movementStart,
      RAW_EXPORT_FILENAMES.movementEnd,
    ]);
    expect(manifest.kind).toBe("storyboard-director-raw-export");
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.generatedAt).toBe(GENERATED_AT);
    expect(manifest.shotState).toEqual({
      id: BASE_STATE.id,
      schemaVersion: SHOT_STATE_SCHEMA_VERSION,
      template: BASE_STATE.template,
      aspectRatio: BASE_STATE.aspectRatio,
    });
    expect(manifest.movement).toEqual({
      type: "dolly_in",
      durationSeconds: 4,
      easing: "ease_in_out",
    });
    // The manifest bytes are the same object, JSON round-trip.
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(manifest);
  });

  it("hashes the exact artifact bytes (cross-checked with node:crypto)", async () => {
    const artifacts = artifactBytes();
    const { manifest } = await buildRawExportManifest(BASE_STATE, artifacts, GENERATED_AT);
    for (const file of manifest.files) {
      const independent = createHash("sha256").update(artifacts[file.name]).digest("hex");
      expect(file.sha256).toBe(independent);
      expect(file.bytes).toBe(artifacts[file.name].byteLength);
    }
  });

  it("is byte-deterministic for one snapshot and timestamp", async () => {
    const first = await buildRawExportManifest(BASE_STATE, artifactBytes(), GENERATED_AT);
    const second = await buildRawExportManifest(BASE_STATE, artifactBytes(), GENERATED_AT);
    expect(Buffer.compare(Buffer.from(first.bytes), Buffer.from(second.bytes))).toBe(0);
  });
});

describe("rawExportManifestSchema (executable manifest contract, fix P1-2)", () => {
  /** A structurally valid manifest object to mutate per negative case. */
  async function validManifest(): Promise<Record<string, unknown>> {
    const { manifest } = await buildRawExportManifest(BASE_STATE, artifactBytes(), GENERATED_AT);
    return structuredClone(manifest) as unknown as Record<string, unknown>;
  }

  const rejects = async (mutate: (manifest: Record<string, unknown>) => void): Promise<void> => {
    const manifest = await validManifest();
    mutate(manifest);
    const result = rawExportManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  };

  it("accepts the builder's own output (schema and builder share one truth)", async () => {
    const manifest = await validManifest();
    expect(rawExportManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("rejects unknown top-level and nested fields (strict objects)", async () => {
    await rejects((manifest) => {
      manifest.extra = "field";
    });
    await rejects((manifest) => {
      (manifest.shotState as Record<string, unknown>).extra = "field";
    });
    await rejects((manifest) => {
      (manifest.files as Array<Record<string, unknown>>)[0].extra = "field";
    });
  });

  it("rejects a wrong kind or an unknown manifestVersion", async () => {
    await rejects((manifest) => {
      manifest.kind = "storyboard-director-export";
    });
    await rejects((manifest) => {
      manifest.manifestVersion = 2;
    });
    await rejects((manifest) => {
      manifest.manifestVersion = "1";
    });
  });

  it("rejects malformed generatedAt timestamps", async () => {
    await rejects((manifest) => {
      manifest.generatedAt = "2026-09-09T12:00:00.000+02:00"; // offset instead of Z
    });
    await rejects((manifest) => {
      manifest.generatedAt = "2026-09-09 12:00:00Z"; // space separator
    });
    await rejects((manifest) => {
      manifest.generatedAt = "not a timestamp";
    });
  });

  it("rejects invalid ShotState metadata (schemaVersion, template, aspectRatio)", async () => {
    await rejects((manifest) => {
      (manifest.shotState as Record<string, unknown>).schemaVersion = 2;
    });
    await rejects((manifest) => {
      ((manifest.shotState as Record<string, unknown>).template as Record<string, unknown>).id =
        "Not-Snake-Case";
    });
    await rejects((manifest) => {
      (
        (manifest.shotState as Record<string, unknown>).template as Record<string, unknown>
      ).version = 0;
    });
    await rejects((manifest) => {
      (
        (manifest.shotState as Record<string, unknown>).template as Record<string, unknown>
      ).reviewStatus = "director_confirmed_execution";
    });
    await rejects((manifest) => {
      (manifest.shotState as Record<string, unknown>).aspectRatio = "4:3";
    });
    await rejects((manifest) => {
      (manifest.shotState as Record<string, unknown>).id = "";
    });
  });

  it("rejects invalid movement metadata", async () => {
    await rejects((manifest) => {
      (manifest.movement as Record<string, unknown>).type = "crane_up";
    });
    await rejects((manifest) => {
      (manifest.movement as Record<string, unknown>).durationSeconds = 0.1;
    });
    await rejects((manifest) => {
      (manifest.movement as Record<string, unknown>).easing = "bounce";
    });
  });

  it("rejects malformed digests and byte counts", async () => {
    await rejects((manifest) => {
      (manifest.files as Array<Record<string, unknown>>)[0].sha256 = "ABC";
    });
    await rejects((manifest) => {
      (manifest.files as Array<Record<string, unknown>>)[0].sha256 =
        "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855"; // uppercase
    });
    await rejects((manifest) => {
      (manifest.files as Array<Record<string, unknown>>)[0].sha256 =
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85"; // 63 chars
    });
    await rejects((manifest) => {
      (manifest.files as Array<Record<string, unknown>>)[0].bytes = 7.5;
    });
    await rejects((manifest) => {
      (manifest.files as Array<Record<string, unknown>>)[0].bytes = -1;
    });
  });

  it("rejects duplicate, missing, extra and unknown files entries", async () => {
    await rejects((manifest) => {
      const files = manifest.files as Array<Record<string, unknown>>;
      files.push({ ...files[0] }); // duplicate of shot-state.json
    });
    await rejects((manifest) => {
      const files = manifest.files as Array<Record<string, unknown>>;
      files.splice(3, 1); // movement-end.json missing
    });
    await rejects((manifest) => {
      const files = manifest.files as Array<Record<string, unknown>>;
      files[0] = { ...files[0], name: "first-frame-enhanced.png" }; // unknown artifact
    });
    await rejects((manifest) => {
      manifest.files = []; // nothing covered
    });
  });

  it("keeps files order free (the multiset is the contract; order is the archive's)", async () => {
    const manifest = await validManifest();
    (manifest.files as unknown[]).reverse();
    expect(rawExportManifestSchema.safeParse(manifest).success).toBe(true);
  });
});

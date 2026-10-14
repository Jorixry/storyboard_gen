import { describe, expect, it } from "vitest";

import { createSequenceIdFactory, defaultShotStateIdFactory } from "@/domain/ids";
import {
  createShotStateFromTemplate,
  SHOT_STATE_SCHEMA_VERSION,
  shotStateFingerprint,
  shotStateSchema,
  type ShotState,
} from "@/domain/shot-state";
import { loadRealTemplates } from "../helpers/content-test-utils";

async function loadOtsTemplate() {
  const templates = await loadRealTemplates();
  const template = templates.find((candidate) => candidate.id === "dialogue_ots_a_to_b");
  if (template === undefined) {
    throw new Error("dialogue_ots_a_to_b not found in real content");
  }
  return template;
}

describe("createShotStateFromTemplate", () => {
  it("creates a different ShotState ID for every call while keeping the rest identical", async () => {
    const template = await loadOtsTemplate();
    const generateId = createSequenceIdFactory("shot");
    const first = createShotStateFromTemplate(template, { generateId });
    const second = createShotStateFromTemplate(template, { generateId });
    expect(first.id).toBe("shot-1");
    expect(second.id).toBe("shot-2");
    expect(first.id).not.toBe(second.id);
    expect({ ...first, id: "" }).toEqual({ ...second, id: "" });
  });

  it("produces distinct IDs with the production default factory (local UUID)", async () => {
    const template = await loadOtsTemplate();
    const first = createShotStateFromTemplate(template);
    const second = createShotStateFromTemplate(template);
    expect(first.id).not.toBe(second.id);
    expect(defaultShotStateIdFactory()).not.toBe(defaultShotStateIdFactory());
  });

  it("produces unique IDs across all three real templates", async () => {
    const templates = await loadRealTemplates();
    const ids = templates.map((template) => createShotStateFromTemplate(template).id);
    expect(new Set(ids).size).toBe(3);
  });

  it("preserves template id, version and reviewStatus", async () => {
    const templates = await loadRealTemplates();
    const expectedStatuses: Record<string, string> = {
      dialogue_medium_two_shot: "engineering_ready", // D030 reframe, re-approval pending
      dialogue_ots_a_to_b: "approved", // D031 written approval 2026-10-11
      dialogue_ots_b_to_a: "approved",
    };
    for (const template of templates) {
      const state = createShotStateFromTemplate(template);
      expect(state.template).toEqual({
        id: template.id,
        version: template.version,
        reviewStatus: template.reviewStatus,
      });
      expect(state.template.reviewStatus).toBe(expectedStatuses[template.id]);
    }
  });

  it("keeps characters exactly character_a and character_b", async () => {
    const templates = await loadRealTemplates();
    for (const template of templates) {
      const state = createShotStateFromTemplate(template);
      expect(state.characters.map((character) => character.id).sort()).toEqual([
        "character_a",
        "character_b",
      ]);
    }
  });

  it("copies movement, camera, scene and aspect ratio completely, keeping the OTS templates at 75mm (D025)", async () => {
    const template = await loadOtsTemplate();
    const state = createShotStateFromTemplate(template);
    expect(state.schemaVersion).toBe(SHOT_STATE_SCHEMA_VERSION);
    expect(state.aspectRatio).toBe("16:9");
    expect(state.scene).toEqual({ presetId: "dialogue_room" });
    expect(state.camera.position).toEqual(template.camera.position);
    expect(state.camera.target).toEqual(template.camera.target);
    expect(state.camera.focalLengthMm).toBe(75);
    expect(state.camera.shotSize).toBe("medium_close_up");
    expect(state.camera.safeRanges).toEqual({ focalLengthMm: [12, 200] });
    expect(state.movement).toEqual(template.movement);
    expect(state.movement.start.focalLengthMm).toBe(75);
    expect(state.movement.end.focalLengthMm).toBe(75);
    expect(state.semantics).toEqual(template.promptSemantics);
  });

  it("applies the initiator-confirmed 75mm OTS focal (D025) to both OTS templates at v3", async () => {
    const templates = await loadRealTemplates();
    for (const id of ["dialogue_ots_a_to_b", "dialogue_ots_b_to_a"]) {
      const template = templates.find((candidate) => candidate.id === id);
      const state = createShotStateFromTemplate(template!);
      expect(template?.version).toBe(3);
      expect(state.template.version).toBe(3);
      expect(state.camera.focalLengthMm).toBe(75);
      expect(state.movement.start.focalLengthMm).toBe(75);
      expect(state.movement.end.focalLengthMm).toBe(75);
      expect(state.semantics.optics).toContain("focal_75mm");
    }
  });

  it("serializes completely to JSON and the round-trip still satisfies the schema", async () => {
    const template = await loadOtsTemplate();
    const state = createShotStateFromTemplate(template);
    const roundTrip = shotStateSchema.safeParse(JSON.parse(JSON.stringify(state)));
    expect(roundTrip.success).toBe(true);
    expect(roundTrip.success && roundTrip.data).toEqual(state);
  });

  it("does not mutate the source template", async () => {
    const template = await loadOtsTemplate();
    const before = JSON.parse(JSON.stringify(template)) as unknown;
    createShotStateFromTemplate(template);
    expect(JSON.parse(JSON.stringify(template))).toEqual(before);
  });

  it("shares no mutable references with the template or between states", async () => {
    const template = await loadOtsTemplate();
    const first = createShotStateFromTemplate(template);
    const second = createShotStateFromTemplate(template);

    first.characters[0].position[0] = 999;
    first.movement.start.position[0] = 999;
    first.semantics.optics.push("mutated");

    expect(template.characters[0].position[0]).toBe(-0.8);
    expect(template.movement.start.position[0]).toBe(-2.15);
    expect(template.promptSemantics.optics).not.toContain("mutated");
    expect(second.characters[0].position[0]).toBe(-0.8);
    expect(second.movement.start.position[0]).toBe(-2.15);
    expect(second.semantics.optics).not.toContain("mutated");
  });
});

describe("shotStateFingerprint (acceptance P2-1 staleness basis)", () => {
  async function baseState(): Promise<ShotState> {
    const template = await loadOtsTemplate();
    return createShotStateFromTemplate(template, { generateId: createSequenceIdFactory("shot") });
  }

  it("is equal for identical content, independent of key insertion order", async () => {
    const state = await baseState();
    expect(shotStateFingerprint(state)).toBe(shotStateFingerprint(state));
    // A deep copy whose object keys were reordered serializes differently but
    // fingerprints identically: canonical JSON sorts keys.
    const reordered = JSON.parse(
      JSON.stringify(state, (_key, value: unknown) =>
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse())
          : value,
      ),
    ) as ShotState;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(state));
    expect(shotStateFingerprint(reordered)).toBe(shotStateFingerprint(state));
  });

  it("changes when ANY same-shot parameter is edited (the id alone is not the comparator)", async () => {
    const state = await baseState();
    const original = shotStateFingerprint(state);

    const editedCamera = structuredClone(state);
    editedCamera.camera.position[0] += 0.01;
    expect(shotStateFingerprint(editedCamera)).not.toBe(original);

    const editedFocal = structuredClone(state);
    editedFocal.camera.focalLengthMm = editedFocal.camera.focalLengthMm + 1;
    expect(shotStateFingerprint(editedFocal)).not.toBe(original);

    const editedAspect = structuredClone(state);
    editedAspect.aspectRatio = editedAspect.aspectRatio === "16:9" ? "9:16" : "16:9";
    expect(shotStateFingerprint(editedAspect)).not.toBe(original);

    const editedCharacter = structuredClone(state);
    editedCharacter.characters[0].rotationYDeg += 1;
    expect(shotStateFingerprint(editedCharacter)).not.toBe(original);

    const editedMovement = structuredClone(state);
    editedMovement.movement.durationSeconds += 0.5;
    expect(shotStateFingerprint(editedMovement)).not.toBe(original);

    const editedSemantics = structuredClone(state);
    editedSemantics.semantics.motion.push("faster_dolly");
    expect(shotStateFingerprint(editedSemantics)).not.toBe(original);
  });

  it("changes when the shot id changes (template reload creates a fresh state)", async () => {
    const template = await loadOtsTemplate();
    const generateId = createSequenceIdFactory("s");
    const first = createShotStateFromTemplate(template, { generateId });
    const second = createShotStateFromTemplate(template, { generateId });
    expect(first.id).toBe("s-1");
    expect(second.id).toBe("s-2");
    expect(shotStateFingerprint(first)).not.toBe(shotStateFingerprint(second));
  });
});

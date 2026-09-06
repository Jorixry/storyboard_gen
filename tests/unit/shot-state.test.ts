import { describe, expect, it } from "vitest";

import { createSequenceIdFactory, defaultShotStateIdFactory } from "@/domain/ids";
import {
  createShotStateFromTemplate,
  SHOT_STATE_SCHEMA_VERSION,
  shotStateSchema,
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
    for (const template of templates) {
      const state = createShotStateFromTemplate(template);
      expect(state.template).toEqual({
        id: template.id,
        version: template.version,
        reviewStatus: template.reviewStatus,
      });
      expect(state.template.reviewStatus).toBe("engineering_ready");
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

  it("copies movement, camera, scene and aspect ratio completely, keeping the OTS templates at 50mm", async () => {
    const template = await loadOtsTemplate();
    const state = createShotStateFromTemplate(template);
    expect(state.schemaVersion).toBe(SHOT_STATE_SCHEMA_VERSION);
    expect(state.aspectRatio).toBe("16:9");
    expect(state.scene).toEqual({ presetId: "dialogue_room" });
    expect(state.camera.position).toEqual(template.camera.position);
    expect(state.camera.target).toEqual(template.camera.target);
    expect(state.camera.focalLengthMm).toBe(50);
    expect(state.camera.shotSize).toBe("medium_close_up");
    expect(state.camera.safeRanges).toEqual({ focalLengthMm: [12, 200] });
    expect(state.movement).toEqual(template.movement);
    expect(state.movement.start.focalLengthMm).toBe(50);
    expect(state.movement.end.focalLengthMm).toBe(50);
    expect(state.semantics).toEqual(template.promptSemantics);
  });

  it("never uses the archive's divergent 75mm OTS value", async () => {
    const templates = await loadRealTemplates();
    for (const id of ["dialogue_ots_a_to_b", "dialogue_ots_b_to_a"]) {
      const template = templates.find((candidate) => candidate.id === id);
      const state = createShotStateFromTemplate(template!);
      expect(state.camera.focalLengthMm).toBe(50);
      expect(state.movement.start.focalLengthMm).toBe(50);
      expect(state.movement.end.focalLengthMm).toBe(50);
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
    expect(template.movement.start.position[0]).toBe(-1.25);
    expect(template.promptSemantics.optics).not.toContain("mutated");
    expect(second.characters[0].position[0]).toBe(-0.8);
    expect(second.movement.start.position[0]).toBe(-1.25);
    expect(second.semantics.optics).not.toContain("mutated");
  });
});

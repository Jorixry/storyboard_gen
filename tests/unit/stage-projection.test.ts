import { describe, expect, it } from "vitest";

import { verticalFovDeg } from "@/domain/camera-math";
import { createSequenceIdFactory } from "@/domain/ids";
import { createShotStateFromTemplate } from "@/domain/shot-state";
import type { ShotState } from "@/domain/shot-state";
import type { ShotTemplate } from "@/domain/shot-template";
import {
  aspectRatioToNumber,
  DIRECTOR_INSPECTION_CAMERA,
  DIALOGUE_ROOM,
  MANNEQUIN,
  projectShotStateToStage,
} from "@/features/rendering/stage-projection";
import { loadRealTemplates } from "../helpers/content-test-utils";

async function loadTemplates(): Promise<ShotTemplate[]> {
  return loadRealTemplates();
}

async function otsAToBState(): Promise<ShotState> {
  const templates = await loadTemplates();
  const template = templates.find((candidate) => candidate.id === "dialogue_ots_a_to_b");
  if (template === undefined) {
    throw new Error("dialogue_ots_a_to_b missing from real content");
  }
  return createShotStateFromTemplate(template, { generateId: createSequenceIdFactory("shot") });
}

describe("projectShotStateToStage — shot camera comes from ShotState", () => {
  it("copies camera position, target and focal length verbatim from the state", async () => {
    const state = await otsAToBState();
    const stage = projectShotStateToStage(state);
    expect(stage.shotCamera.position).toEqual([-1.25, 1.7, 2]);
    expect(stage.shotCamera.target).toEqual([0.8, 1.55, 0]);
    expect(stage.shotCamera.focalLengthMm).toBe(50);
  });

  it("derives the Three.js FOV from the documented film-gate math (50mm, 16:9)", async () => {
    const state = await otsAToBState();
    const stage = projectShotStateToStage(state);
    expect(stage.shotCamera.fovDeg).toBe(verticalFovDeg(50, "16:9"));
    expect(stage.shotCamera.fovDeg).toBeCloseTo(22.895192527371208, 9);
    expect(stage.shotCamera.fovDeg).not.toBe(50);
  });

  it("follows the state when the camera pose changes (no hardcoded template camera)", async () => {
    const state = await otsAToBState();
    state.camera.position = [3.1, 2.2, 4.4];
    state.camera.target = [-2.0, 1.3, -0.5];
    state.camera.focalLengthMm = 85;
    const stage = projectShotStateToStage(state);
    expect(stage.shotCamera.position).toEqual([3.1, 2.2, 4.4]);
    expect(stage.shotCamera.target).toEqual([-2.0, 1.3, -0.5]);
    expect(stage.shotCamera.fovDeg).toBeCloseTo(verticalFovDeg(85, "16:9"), 12);
  });

  it("keeps the aspect ratio and its numeric form", async () => {
    const state = await otsAToBState();
    const stage = projectShotStateToStage(state);
    expect(stage.aspectRatio).toBe("16:9");
    expect(aspectRatioToNumber("16:9")).toBeCloseTo(16 / 9, 12);
    expect(aspectRatioToNumber("9:16")).toBeCloseTo(9 / 16, 12);
  });
});

describe("projectShotStateToStage — characters come from ShotState", () => {
  it("places character_a at negative X (+90°) and character_b at positive X (-90°)", async () => {
    const state = await otsAToBState();
    const stage = projectShotStateToStage(state);
    expect(stage.characters).toEqual([
      { id: "character_a", position: [-0.8, 0, 0], rotationYDeg: 90 },
      { id: "character_b", position: [0.8, 0, 0], rotationYDeg: -90 },
    ]);
  });

  it("follows swapped or moved characters instead of hardcoding blocking", async () => {
    const state = await otsAToBState();
    const [a, b] = state.characters;
    a.position = [0.8, 0, -0.4];
    a.rotationYDeg = -90;
    b.position = [-0.8, 0, 0.6];
    b.rotationYDeg = 90;
    const stage = projectShotStateToStage(state);
    expect(stage.characters).toEqual([
      { id: "character_a", position: [0.8, 0, -0.4], rotationYDeg: -90 },
      { id: "character_b", position: [-0.8, 0, 0.6], rotationYDeg: 90 },
    ]);
  });

  it("does not lose either character when projecting", async () => {
    const templates = await loadTemplates();
    for (const template of templates) {
      const state = createShotStateFromTemplate(template);
      const stage = projectShotStateToStage(state);
      expect(stage.characters.map((character) => character.id).sort()).toEqual([
        "character_a",
        "character_b",
      ]);
    }
  });
});

describe("projectShotStateToStage — movement data preserved without tweening", () => {
  it("carries movement start/end poses completely, including the 50mm OTS focal length", async () => {
    const state = await otsAToBState();
    const stage = projectShotStateToStage(state);
    expect(stage.movement.type).toBe("dolly_in");
    expect(stage.movement.durationSeconds).toBe(4);
    expect(stage.movement.easing).toBe("ease_in_out");
    expect(stage.movement.start.position).toEqual([-1.25, 1.7, 2]);
    expect(stage.movement.start.target).toEqual([0.8, 1.55, 0]);
    expect(stage.movement.start.focalLengthMm).toBe(50);
    expect(stage.movement.end.position).toEqual([-1.05, 1.68, 1.4]);
    expect(stage.movement.end.target).toEqual([0.8, 1.55, 0]);
    expect(stage.movement.end.focalLengthMm).toBe(50);
  });

  it("differs between the movement start and end descriptors (dolly_in is not flattened)", async () => {
    const state = await otsAToBState();
    const stage = projectShotStateToStage(state);
    expect(stage.movement.start.position).not.toEqual(stage.movement.end.position);
  });
});

describe("projectShotStateToStage — deterministic scene constants", () => {
  it("uses the fixed dialogue room and mannequin spec for every state", async () => {
    const state = await otsAToBState();
    const stage = projectShotStateToStage(state);
    expect(stage.room).toEqual(DIALOGUE_ROOM);
    expect(MANNEQUIN.colorByCharacterId.character_a).not.toBe(
      MANNEQUIN.colorByCharacterId.character_b,
    );
    expect(stage.shotCamera.near).toBeGreaterThan(0);
    expect(stage.shotCamera.far).toBeGreaterThan(stage.shotCamera.near);
  });

  it("uses an inspection camera that never coincides with any template shot camera", async () => {
    const templates = await loadTemplates();
    for (const template of templates) {
      const state = createShotStateFromTemplate(template);
      const stage = projectShotStateToStage(state);
      expect(stage.inspectionCamera).toEqual(DIRECTOR_INSPECTION_CAMERA);
      expect(stage.inspectionCamera.position).not.toEqual(stage.shotCamera.position);
      expect(stage.inspectionCamera.target).not.toEqual(stage.shotCamera.target);
    }
  });

  it("is pure: mutating the state after projection leaves the projection unchanged", async () => {
    const state = await otsAToBState();
    const stage = projectShotStateToStage(state);
    const before = JSON.parse(JSON.stringify(stage)) as unknown;
    state.camera.position[0] = 999;
    state.characters[0].position[0] = 999;
    state.movement.end.position[0] = 999;
    expect(JSON.parse(JSON.stringify(stage))).toEqual(before);
  });

  it("rejects unknown scene presets explicitly", async () => {
    const state = await otsAToBState();
    // Bypass typing deliberately: the projection must not silently render
    // scene data it has no room spec for.
    (state.scene as { presetId: string }).presetId = "nonexistent_room";
    expect(() => projectShotStateToStage(state)).toThrow(/unsupported scene preset/);
  });
});

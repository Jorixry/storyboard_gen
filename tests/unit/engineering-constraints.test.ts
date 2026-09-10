import { describe, expect, it } from "vitest";

import {
  CAMERA_POSITION_X_RANGE_M,
  CAMERA_POSITION_Y_RANGE_M,
  CAMERA_POSITION_Z_RANGE_M,
  CAMERA_TARGET_X_RANGE_M,
  CAMERA_TARGET_Y_RANGE_M,
  CAMERA_TARGET_Z_RANGE_M,
  CAMERA_DISTANCE_STEP_FRACTION,
  CHARACTER_POSITION_X_RANGE_M,
  CHARACTER_POSITION_Y_M,
  CHARACTER_POSITION_Z_RANGE_M,
  CHARACTER_YAW_RANGE_DEG,
  EMPHASIS_BLEND_FRACTION,
  FOCAL_FEEL_PRESETS,
  MIN_CAMERA_TARGET_DISTANCE_M,
  MIN_CHARACTER_SEPARATION_M,
} from "@/domain/engineering-constraints";
import { FOCAL_LENGTH_MAX_MM, FOCAL_LENGTH_MIN_MM } from "@/domain/schemas";
import { DIALOGUE_ROOM, MANNEQUIN } from "@/features/rendering/stage-projection";
import { loadRealTemplates } from "../helpers/content-test-utils";

/**
 * The provisional engineering constraints must be DERIVED from the rendered
 * dialogue_room geometry (not independent magic numbers), so any future room
 * change that forgets the constraints fails here. The camera box insets the
 * room by 0.1 m on every side, except the floor where a 0.3 m clearance is
 * used; characters inset by 0.3 m on x/z and stand on the floor (y = 0).
 */
describe("provisional engineering constraints are derived from the dialogue_room", () => {
  it("camera/-target box follows the room extents inset by 0.1 m (0.3 m floor clearance)", () => {
    const halfWidth = DIALOGUE_ROOM.widthX / 2;
    const halfDepth = DIALOGUE_ROOM.depthZ / 2;
    expect(CAMERA_POSITION_X_RANGE_M).toEqual({ min: -halfWidth + 0.1, max: halfWidth - 0.1 });
    expect(CAMERA_POSITION_Z_RANGE_M).toEqual({
      min: DIALOGUE_ROOM.centerZ - halfDepth + 0.1,
      max: DIALOGUE_ROOM.centerZ + halfDepth - 0.1,
    });
    expect(CAMERA_POSITION_Y_RANGE_M.min).toBe(0.3);
    expect(CAMERA_POSITION_Y_RANGE_M.max).toBeCloseTo(DIALOGUE_ROOM.wallHeightY - 0.1, 9);
    // Targets share the same box.
    expect(CAMERA_TARGET_X_RANGE_M).toEqual(CAMERA_POSITION_X_RANGE_M);
    expect(CAMERA_TARGET_Y_RANGE_M).toEqual(CAMERA_POSITION_Y_RANGE_M);
    expect(CAMERA_TARGET_Z_RANGE_M).toEqual(CAMERA_POSITION_Z_RANGE_M);
  });

  it("the room actually contains the full constraint box", () => {
    expect(CAMERA_POSITION_X_RANGE_M.min).toBeGreaterThanOrEqual(-DIALOGUE_ROOM.widthX / 2);
    expect(CAMERA_POSITION_X_RANGE_M.max).toBeLessThanOrEqual(DIALOGUE_ROOM.widthX / 2);
    expect(CAMERA_POSITION_Z_RANGE_M.min).toBeGreaterThanOrEqual(
      DIALOGUE_ROOM.centerZ - DIALOGUE_ROOM.depthZ / 2,
    );
    expect(CAMERA_POSITION_Z_RANGE_M.max).toBeLessThanOrEqual(
      DIALOGUE_ROOM.centerZ + DIALOGUE_ROOM.depthZ / 2,
    );
    expect(CAMERA_POSITION_Y_RANGE_M.max).toBeLessThanOrEqual(DIALOGUE_ROOM.wallHeightY);
  });

  it("character box insets x/z by 0.3 m and pins y to the floor", () => {
    expect(CHARACTER_POSITION_X_RANGE_M).toEqual({ min: -2.7, max: 2.7 });
    expect(CHARACTER_POSITION_Z_RANGE_M).toEqual({
      min: DIALOGUE_ROOM.centerZ - DIALOGUE_ROOM.depthZ / 2 + 0.3,
      max: DIALOGUE_ROOM.centerZ + DIALOGUE_ROOM.depthZ / 2 - 0.3,
    });
    expect(CHARACTER_POSITION_Y_M).toBe(0);
  });

  it("the minimum character separation clears both mannequin base discs", () => {
    expect(MIN_CHARACTER_SEPARATION_M).toBeGreaterThanOrEqual(2 * MANNEQUIN.baseDisc.radius + 0.1);
  });

  it("keeps every real template pose inside the constraint boxes (no clamping at rest)", async () => {
    const templates = await loadRealTemplates();
    for (const template of templates) {
      const { camera, characters } = template;
      for (const [value, range, axis] of [
        [camera.position[0], CAMERA_POSITION_X_RANGE_M, "camera.x"],
        [camera.position[1], CAMERA_POSITION_Y_RANGE_M, "camera.y"],
        [camera.position[2], CAMERA_POSITION_Z_RANGE_M, "camera.z"],
        [camera.target[0], CAMERA_TARGET_X_RANGE_M, "target.x"],
        [camera.target[1], CAMERA_TARGET_Y_RANGE_M, "target.y"],
        [camera.target[2], CAMERA_TARGET_Z_RANGE_M, "target.z"],
      ] as const) {
        expect(value, `${template.id} ${axis}`).toBeGreaterThanOrEqual(range.min);
        expect(value, `${template.id} ${axis}`).toBeLessThanOrEqual(range.max);
      }
      for (const character of characters) {
        expect(character.position[0]).toBeGreaterThanOrEqual(CHARACTER_POSITION_X_RANGE_M.min);
        expect(character.position[0]).toBeLessThanOrEqual(CHARACTER_POSITION_X_RANGE_M.max);
        expect(character.position[2]).toBeGreaterThanOrEqual(CHARACTER_POSITION_Z_RANGE_M.min);
        expect(character.position[2]).toBeLessThanOrEqual(CHARACTER_POSITION_Z_RANGE_M.max);
        expect(character.position[1]).toBe(0);
      }
    }
  });
});

describe("constraint constants match the content Schema and command semantics", () => {
  it("focal bounds mirror the Schema range", () => {
    // The focal clamp range comes from the schema, not from this module.
    expect(FOCAL_LENGTH_MIN_MM).toBe(12);
    expect(FOCAL_LENGTH_MAX_MM).toBe(200);
  });

  it("focal presets stay the provisional engineering set against the shipped template focals", async () => {
    const templates = await loadRealTemplates();
    const shipped = templates.map((template) => template.camera.focalLengthMm).sort();
    // 35mm medium two-shot + the director-ruled 75mm OTS pair (v2.1 CSV).
    expect(shipped).toEqual([35, 75, 75]);
    // The natural preset matches a shipped value; the portrait preset stays
    // 50mm as a product-level "standard portrait" alias and no longer equals
    // any shipped template focal (docs/DECISIONS.md, 2026-09-10 ruling).
    expect(Object.values(FOCAL_FEEL_PRESETS)).toContain(35);
    expect(Object.values(FOCAL_FEEL_PRESETS)).not.toContain(75);
  });

  it("step and blend fractions are the documented engineering values", () => {
    expect(CAMERA_DISTANCE_STEP_FRACTION).toBe(0.2);
    expect(EMPHASIS_BLEND_FRACTION).toBe(0.5);
    expect(MIN_CAMERA_TARGET_DISTANCE_M).toBe(0.3);
    expect(CHARACTER_YAW_RANGE_DEG).toEqual({ min: -180, max: 180 });
  });
});

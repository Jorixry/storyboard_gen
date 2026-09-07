import { describe, expect, it } from "vitest";

import {
  CharacterOverlapError,
  DegenerateCameraGeometryError,
  emphasizeCharacter,
  InvalidCommandInputError,
  makeCloser,
  makeFarther,
  resetShotStateToTemplate,
  setAspectRatio,
  setCameraFocalLength,
  setCameraPosition,
  setCameraTarget,
  setCharacterPosition,
  setCharacterYaw,
  setFocalFeel,
} from "@/domain/commands";
import { createSequenceIdFactory } from "@/domain/ids";
import { createShotStateFromTemplate, type ShotState } from "@/domain/shot-state";
import type { ShotTemplate } from "@/domain/shot-template";
import { FOCAL_FEEL_PRESETS } from "@/domain/engineering-constraints";
import { verticalFovDeg } from "@/domain/camera-math";
import { loadRealTemplates } from "../helpers/content-test-utils";

async function stateFrom(templateId: string): Promise<ShotState> {
  const templates = await loadRealTemplates();
  const template = templates.find((candidate) => candidate.id === templateId);
  if (template === undefined) {
    throw new Error(`${templateId} missing from real content`);
  }
  return createShotStateFromTemplate(template, {
    generateId: createSequenceIdFactory("shot"),
  });
}

async function otsTemplate(): Promise<ShotTemplate> {
  const templates = await loadRealTemplates();
  const template = templates.find((candidate) => candidate.id === "dialogue_ots_a_to_b");
  if (template === undefined) {
    throw new Error("dialogue_ots_a_to_b missing");
  }
  return template;
}

const distance = (state: ShotState): number =>
  Math.hypot(
    state.camera.target[0] - state.camera.position[0],
    state.camera.target[1] - state.camera.position[1],
    state.camera.target[2] - state.camera.position[2],
  );

const withPose = (
  state: ShotState,
  position: [number, number, number],
  target: [number, number, number],
): ShotState => ({
  ...state,
  camera: { ...state.camera, position, target },
});

describe("makeCloser / makeFarther — derived from the CURRENT camera/target geometry", () => {
  it("moves 20% of the remaining distance toward the target without re-aiming (OTS A→B)", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b");
    const next = makeCloser(state);
    // position + 0.2 * (target - position), componentwise.
    expect(next.camera.position[0]).toBeCloseTo(-1.25 + 0.2 * 2.05, 12);
    expect(next.camera.position[1]).toBeCloseTo(1.7 + 0.2 * -0.15, 12);
    expect(next.camera.position[2]).toBeCloseTo(2 + 0.2 * -2, 12);
    expect(next.camera.target).toEqual(state.camera.target);
    expect(distance(next)).toBeCloseTo(distance(state) * 0.8, 12);
  });

  it("moves away from the target by the same fraction (medium two-shot)", async () => {
    const state = await stateFrom("dialogue_medium_two_shot");
    const next = makeFarther(state);
    expect(next.camera.position[0]).toBeCloseTo(0, 12);
    expect(next.camera.position[1]).toBeCloseTo(1.6 + 0.2 * 0.05, 12);
    expect(next.camera.position[2]).toBeCloseTo(3.4 + 0.2 * 3.4, 12);
    expect(distance(next)).toBeCloseTo(distance(state) * 1.2, 12);
  });

  it("follows a moved camera: repeated closer steps shrink the distance geometrically", async () => {
    let state = await stateFrom("dialogue_ots_a_to_b");
    const initial = distance(state);
    for (let step = 0; step < 6; step += 1) {
      const before = distance(state);
      state = makeCloser(state);
      expect(distance(state)).toBeLessThan(before);
    }
    expect(distance(state)).toBeCloseTo(initial * 0.8 ** 6, 9);
  });

  it("farther is bounded by the room box and becomes stable at the wall (idempotent)", async () => {
    let state = await stateFrom("dialogue_medium_two_shot");
    for (let step = 0; step < 60; step += 1) {
      const before = distance(state);
      state = makeFarther(state);
      expect(distance(state)).toBeGreaterThanOrEqual(before);
      expect(state.camera.position[2]).toBeLessThanOrEqual(4.4);
    }
    expect(state.camera.position[2]).toBe(4.4);
    const settled = makeFarther(state);
    expect(settled.camera.position).toEqual(state.camera.position);
  });

  it("never lets a closer step cross the minimum camera-target distance", async () => {
    const base = await stateFrom("dialogue_ots_a_to_b");
    const tiny = withPose(base, [-1.24, 1.698, 1.96], [0.8, 1.55, 0]); // ~0.36 m from target
    const target = tiny.camera.target;
    const next = makeCloser(tiny);
    const d = Math.hypot(
      next.camera.position[0] - target[0],
      next.camera.position[1] - target[1],
      next.camera.position[2] - target[2],
    );
    expect(d).toBeGreaterThanOrEqual(0.3 - 1e-9);
  });

  it("refuses to operate on an already-degenerate camera pose", async () => {
    const base = await stateFrom("dialogue_ots_a_to_b");
    const degenerate = withPose(base, [0.8, 1.55, 0.05], [0.8, 1.55, 0]); // 0.05 m apart
    expect(() => makeCloser(degenerate)).toThrow(DegenerateCameraGeometryError);
    expect(() => makeFarther(degenerate)).toThrow(DegenerateCameraGeometryError);
  });
});

describe("emphasizeCharacter — driven by the CURRENT character transforms", () => {
  it("blends the medium two-shot target halfway toward character A's live position", async () => {
    const state = await stateFrom("dialogue_medium_two_shot");
    const next = emphasizeCharacter(state, "character_a");
    expect(next.camera.target[0]).toBeCloseTo(-0.4, 12); // 0 -> halfway to -0.8
    expect(next.camera.target[1]).toBe(state.camera.target[1]); // height untouched
    expect(next.camera.target[2]).toBeCloseTo(0, 12);
  });

  it("blends toward character B symmetrically", async () => {
    const state = await stateFrom("dialogue_medium_two_shot");
    const next = emphasizeCharacter(state, "character_b");
    expect(next.camera.target[0]).toBeCloseTo(0.4, 12);
  });

  it("follows a character that was moved first (no hardcoded template position)", async () => {
    const state = await stateFrom("dialogue_medium_two_shot");
    const moved = setCharacterPosition(state, "character_a", [-1.5, 0, 0]);
    const next = emphasizeCharacter(moved, "character_a");
    expect(next.camera.target[0]).toBeCloseTo(-0.75, 12); // halfway to -1.5
  });

  it("is idempotent when the target already sits over the character (OTS A→B, B primary)", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b");
    const next = emphasizeCharacter(state, "character_b");
    expect(next.camera.target).toEqual(state.camera.target);
  });

  it("re-aims the OTS A→B target toward A when A is emphasized", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b");
    const next = emphasizeCharacter(state, "character_a");
    expect(next.camera.target[0]).toBeCloseTo(0, 12); // 0.8 -> halfway to -0.8
    expect(next.camera.target[1]).toBeCloseTo(1.55, 12);
  });
});

describe("focal feel presets and focal-length clamp", () => {
  it("exposes the provisional engineering presets incl. the current template values 35/50", () => {
    expect(FOCAL_FEEL_PRESETS).toEqual({ wide: 24, natural: 35, portrait: 50, compressed: 85 });
  });

  it("applies a preset to the current camera only", async () => {
    const state = await stateFrom("dialogue_medium_two_shot"); // 35mm
    const next = setFocalFeel(state, "portrait");
    expect(next.camera.focalLengthMm).toBe(50);
    expect(verticalFovDeg(50, next.aspectRatio)).toBeCloseTo(22.895192527371208, 9);
  });

  it("clamps out-of-range focal lengths to the Schema bounds [12, 200]", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b");
    expect(setCameraFocalLength(state, 500).camera.focalLengthMm).toBe(200);
    expect(setCameraFocalLength(state, 5).camera.focalLengthMm).toBe(12);
    expect(setCameraFocalLength(state, 62.5).camera.focalLengthMm).toBe(62.5);
  });

  it("rejects non-finite focal lengths", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b");
    expect(() => setCameraFocalLength(state, Number.NaN)).toThrow(InvalidCommandInputError);
    expect(() => setCameraFocalLength(state, Number.POSITIVE_INFINITY)).toThrow(
      InvalidCommandInputError,
    );
  });
});

describe("aspect ratio", () => {
  it("changes only the top-level aspect ratio", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b");
    const next = setAspectRatio(state, "9:16");
    expect(next.aspectRatio).toBe("9:16");
    expect(next.camera).toEqual(state.camera);
    // The FOV difference is derived downstream by the film-gate math:
    expect(verticalFovDeg(50, "9:16")).toBeCloseTo(39.5978, 3);
    expect(verticalFovDeg(50, "9:16")).toBeGreaterThan(verticalFovDeg(50, "16:9"));
  });
});

describe("constrained direct transforms", () => {
  it("clamps camera position to the room box", async () => {
    const state = await stateFrom("dialogue_medium_two_shot");
    const next = setCameraPosition(state, [999, 999, 999]);
    expect(next.camera.position).toEqual([2.9, 2.7, 4.4]);
  });

  it("clamps camera target to the room box", async () => {
    const state = await stateFrom("dialogue_medium_two_shot");
    const next = setCameraTarget(state, [-999, 0.1, -999]);
    expect(next.camera.target).toEqual([-2.9, 0.3, -2.4]);
  });

  it("rejects a camera position that degenerates toward the target", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b"); // target [0.8,1.55,0]
    expect(() => setCameraPosition(state, [0.85, 1.56, 0])).toThrow(DegenerateCameraGeometryError);
  });

  it("rejects a target that degenerates toward the camera position", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b"); // position [-1.25,1.7,2]
    expect(() => setCameraTarget(state, [-1.24, 1.7, 2])).toThrow(DegenerateCameraGeometryError);
  });

  it("rejects non-finite vectors", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b");
    expect(() => setCameraPosition(state, [Number.NaN, 1.7, 2])).toThrow(InvalidCommandInputError);
    expect(() => setCameraTarget(state, [0, Number.POSITIVE_INFINITY, 0])).toThrow(
      InvalidCommandInputError,
    );
    expect(() => setCharacterPosition(state, "character_a", [0, 0, Number.NaN])).toThrow(
      InvalidCommandInputError,
    );
    expect(() => setCharacterYaw(state, "character_a", Number.NaN)).toThrow(
      InvalidCommandInputError,
    );
  });

  it("pins characters to the floor and clamps x/z to the room box", async () => {
    const state = await stateFrom("dialogue_medium_two_shot");
    const next = setCharacterPosition(state, "character_a", [999, 1.5, 999]);
    const characterA = next.characters.find((c) => c.id === "character_a")!;
    expect(characterA.position).toEqual([2.7, 0, 4.2]);
  });

  it("refuses positions that would overlap the two characters", async () => {
    const state = await stateFrom("dialogue_medium_two_shot"); // A at -0.8
    expect(() => setCharacterPosition(state, "character_b", [-0.5, 0, 0])).toThrow(
      CharacterOverlapError,
    );
    // Exactly the minimum separation is allowed.
    expect(() => setCharacterPosition(state, "character_b", [-0.2, 0, 0])).not.toThrow();
  });

  it("wraps yaw into [-180, 180]", async () => {
    const state = await stateFrom("dialogue_medium_two_shot");
    expect(setCharacterYaw(state, "character_a", 270).characters[0].rotationYDeg).toBe(-90);
    expect(setCharacterYaw(state, "character_a", -270).characters[0].rotationYDeg).toBe(90);
    expect(setCharacterYaw(state, "character_a", 360).characters[0].rotationYDeg).toBe(0);
    expect(setCharacterYaw(state, "character_a", 90).characters[0].rotationYDeg).toBe(90);
  });
});

describe("resetShotStateToTemplate", () => {
  it("keeps the ShotState ID while restoring every template value", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b");
    const template = await otsTemplate();
    const edited = setCameraFocalLength(
      emphasizeCharacter(makeCloser(setAspectRatio(state, "9:16")), "character_a"),
      85,
    );
    const reset = resetShotStateToTemplate(edited, template);
    expect(reset.id).toBe(edited.id);
    expect(reset.aspectRatio).toBe("16:9");
    expect(reset.camera.position).toEqual(template.camera.position);
    expect(reset.camera.target).toEqual(template.camera.target);
    expect(reset.camera.focalLengthMm).toBe(50);
    expect(reset.characters).toEqual(template.characters);
    expect(reset.movement).toEqual(template.movement);
    expect(reset.semantics).toEqual(template.promptSemantics);
  });
});

describe("command purity — invariants every command must keep", () => {
  /** Commands that never rewrite semantics. */
  const semanticsPreservingCommands: Array<[string, (state: ShotState) => ShotState]> = [
    ["makeCloser", makeCloser],
    ["makeFarther", makeFarther],
    ["setAspectRatio(9:16)", (s) => setAspectRatio(s, "9:16")],
    ["setCameraPosition", (s) => setCameraPosition(s, [1, 1.5, 2])],
    ["setCameraTarget", (s) => setCameraTarget(s, [0, 1.5, 0])],
    ["setCharacterPositionA", (s) => setCharacterPosition(s, "character_a", [-1, 0, 0.2])],
    ["setCharacterYawA", (s) => setCharacterYaw(s, "character_a", 45)],
  ];

  /** Commands that synchronize their related semantic family. */
  const semanticsSyncingCommands: Array<[string, (state: ShotState) => ShotState]> = [
    ["emphasizeCharacterA", (s) => emphasizeCharacter(s, "character_a")],
    ["emphasizeCharacterB", (s) => emphasizeCharacter(s, "character_b")],
    ["setFocalFeel(natural)", (s) => setFocalFeel(s, "natural")],
    ["setCameraFocalLength", (s) => setCameraFocalLength(s, 40)],
  ];

  const allCommands = [...semanticsPreservingCommands, ...semanticsSyncingCommands];

  it.each(allCommands)("%s does not mutate the input state", async (_name, command) => {
    const state = await stateFrom("dialogue_ots_a_to_b");
    const before = JSON.parse(JSON.stringify(state)) as unknown;
    const next = command(state);
    expect(JSON.parse(JSON.stringify(state))).toEqual(before);
    expect(next).not.toBe(state);
  });

  it.each(semanticsPreservingCommands)(
    "%s keeps movement, semantics and template metadata untouched",
    async (_name, command) => {
      const state = await stateFrom("dialogue_ots_a_to_b");
      const next = command(state);
      expect(next.movement).toEqual(state.movement);
      expect(next.movement).toBe(state.movement); // not even re-copied
      expect(next.semantics).toBe(state.semantics);
      expect(next.template).toBe(state.template);
      expect(next.schemaVersion).toBe(state.schemaVersion);
      expect(next.id).toBe(state.id);
      expect(next.scene).toBe(state.scene);
      expect(next.characters.map((c) => c.id).sort()).toEqual(["character_a", "character_b"]);
    },
  );

  it.each(semanticsSyncingCommands)(
    "%s rewrites ONLY its own semantic family and keeps movement/template metadata untouched",
    async (name, command) => {
      const state = await stateFrom("dialogue_ots_a_to_b");
      const next = command(state);
      expect(next.movement).toBe(state.movement);
      expect(next.template).toBe(state.template);
      expect(next.schemaVersion).toBe(state.schemaVersion);
      expect(next.id).toBe(state.id);
      expect(next.scene).toBe(state.scene);
      // The untouched semantic lists keep their references; the touched list
      // (optics for focal, subjects for emphasis) is the only one rebuilt.
      const family = name.startsWith("emphasizeCharacter") ? "subjects" : "optics";
      for (const list of ["subjects", "composition", "optics", "motion", "continuity"] as const) {
        if (list === family) {
          expect(next.semantics[list]).not.toBe(state.semantics[list]);
        } else {
          expect(next.semantics[list]).toBe(state.semantics[list]);
        }
      }
      // No duplicate tokens can appear in any list.
      for (const list of ["subjects", "composition", "optics", "motion", "continuity"] as const) {
        expect(new Set(next.semantics[list]).size).toBe(next.semantics[list].length);
      }
    },
  );

  it("keeps the two OTS movement poses at 50mm after any current-camera edit", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b");
    const next = setFocalFeel(makeCloser(state), "compressed");
    expect(next.movement.start.focalLengthMm).toBe(50);
    expect(next.movement.end.focalLengthMm).toBe(50);
  });
});

describe("focal commands synchronize the canonical focal semantics (no contradictory facts)", () => {
  it("setFocalFeel replaces the template focal token with the new one", async () => {
    const state = await stateFrom("dialogue_medium_two_shot"); // 35mm
    expect(state.semantics.optics).toContain("focal_35mm");
    const next = setFocalFeel(state, "portrait");
    expect(next.camera.focalLengthMm).toBe(50);
    expect(next.semantics.optics).toContain("focal_50mm");
    // NEGATIVE: the stale token that contradicts the camera is gone.
    expect(next.semantics.optics).not.toContain("focal_35mm");
    // Non-focal optics tokens are preserved verbatim.
    expect(next.semantics.optics).toContain("eye_level");
  });

  it("setCameraFocalLength keeps optics consistent for arbitrary clamped values", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b"); // 50mm
    expect(setCameraFocalLength(state, 85).semantics.optics).toContain("focal_85mm");
    expect(setCameraFocalLength(state, 62.5).semantics.optics).toContain("focal_62.5mm");
    // The clamp happens BEFORE the token sync: 500 -> 200 -> focal_200mm.
    const clamped = setCameraFocalLength(state, 500);
    expect(clamped.camera.focalLengthMm).toBe(200);
    expect(clamped.semantics.optics).toContain("focal_200mm");
    expect(clamped.semantics.optics).not.toContain("focal_50mm");
  });

  it("is idempotent: re-applying the same focal length neither duplicates nor reorders", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b");
    const once = setCameraFocalLength(state, 50);
    expect(once.semantics.optics).toEqual(state.semantics.optics);
    expect(once.semantics.optics.filter((t) => t.startsWith("focal_"))).toHaveLength(1);
    const twice = setCameraFocalLength(once, 50);
    expect(twice.semantics.optics).toEqual(once.semantics.optics);
  });

  it("the camera value and the semantic token can never disagree afterwards", async () => {
    const state = await stateFrom("dialogue_medium_two_shot");
    const edited = setCameraFocalLength(setFocalFeel(state, "compressed"), 24);
    const focalTokens = edited.semantics.optics.filter((token) =>
      /^focal_\d+(?:\.\d+)?mm$/.test(token),
    );
    expect(focalTokens).toEqual([`focal_${edited.camera.focalLengthMm}mm`]);
  });
});

describe("emphasize commands synchronize the primary-subject semantics", () => {
  it("replaces an equal-prominence subject with the emphasized primary (medium two-shot)", async () => {
    const state = await stateFrom("dialogue_medium_two_shot");
    expect(state.semantics.subjects).toContain("character_a_and_character_b_equal_prominence");
    const next = emphasizeCharacter(state, "character_b");
    expect(next.semantics.subjects).toContain("character_b_primary");
    // NEGATIVE: claiming equal prominence would contradict the aimed target.
    expect(next.semantics.subjects).not.toContain("character_a_and_character_b_equal_prominence");
    expect(next.semantics.subjects).not.toContain("character_a_primary");
  });

  it("swaps the OTS primary and preserves the unrelated foreground-shoulder token", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b");
    expect(state.semantics.subjects).toEqual([
      "character_b_primary",
      "character_a_shoulder_soft_foreground",
    ]);
    const next = emphasizeCharacter(state, "character_a");
    // NEGATIVE: the old primary is gone; the shoulder token survives verbatim.
    expect(next.semantics.subjects).not.toContain("character_b_primary");
    expect(next.semantics.subjects).toContain("character_a_primary");
    expect(next.semantics.subjects).toContain("character_a_shoulder_soft_foreground");
    expect(next.semantics.subjects).toHaveLength(2);
  });

  it("is idempotent when the target already emphasizes that character", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b"); // already character_b_primary
    const next = emphasizeCharacter(state, "character_b");
    expect(next.semantics.subjects).toEqual(state.semantics.subjects);
    expect(next.semantics.subjects.filter((t) => t.endsWith("_primary"))).toHaveLength(1);
  });

  it("follows a moved character and keeps exactly one primary token", async () => {
    const state = await stateFrom("dialogue_medium_two_shot");
    const moved = setCharacterPosition(state, "character_a", [-1.5, 0, 0]);
    const next = emphasizeCharacter(moved, "character_a");
    expect(next.semantics.subjects).toEqual(["character_a_primary"]);
    expect(next.semantics.subjects.filter((t) => t.endsWith("_primary"))).toHaveLength(1);
  });
});

describe("setAspectRatio rejects illegal values at runtime", () => {
  it("accepts both legal ratios", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b");
    expect(setAspectRatio(state, "16:9").aspectRatio).toBe("16:9");
    expect(setAspectRatio(state, "9:16").aspectRatio).toBe("9:16");
  });

  it("NEGATIVE: rejects values outside the schema enum instead of writing them", async () => {
    const state = await stateFrom("dialogue_ots_a_to_b");
    for (const illegal of ["4:3", "1:1", "", "16:9 ", 0, null] as unknown as Parameters<
      typeof setAspectRatio
    >[1][]) {
      expect(() => setAspectRatio(state, illegal)).toThrow(InvalidCommandInputError);
    }
  });
});

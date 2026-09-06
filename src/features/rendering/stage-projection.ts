/**
 * ShotState -> stage projection.
 *
 * This is the rendering boundary's single adapter from canonical state to
 * scene data. The Three.js scene must be a projection of `ShotState`, never a
 * second source of truth: every camera, character and movement value below is
 * copied from the state, and only genuinely rendering-owned data (room
 * dimensions, mannequin proportions, inspection camera, clip planes, colors)
 * is defined here.
 *
 * The module intentionally has no React or Three.js imports so the projection
 * is unit-testable in a plain Node environment.
 */
import { verticalFovDeg } from "@/domain/camera-math";
import type { AspectRatio, CameraState, Vec3 } from "@/domain/schemas";
import type { ShotState } from "@/domain/shot-state";

/** Rendering clip planes in metres; not part of template truth. */
export const SHOT_CAMERA_NEAR_M = 0.05;
export const SHOT_CAMERA_FAR_M = 12;

export interface ShotCameraDescriptor {
  /** Copied verbatim from ShotState camera/pose position. */
  position: Vec3;
  /** Copied verbatim from ShotState camera/pose target. */
  target: Vec3;
  /** Copied verbatim from ShotState (retained for evidence/inspection). */
  focalLengthMm: number;
  /** Derived from focalLengthMm + aspectRatio via the domain film-gate math. */
  fovDeg: number;
  near: number;
  far: number;
}

export interface RoomSpec {
  /** Full extents in metres; the room interior box. */
  widthX: number;
  depthZ: number;
  wallHeightY: number;
  /** Center of the floor rectangle. */
  centerX: number;
  centerZ: number;
  floorColor: string;
  wallColor: string;
  gridColorCenter: string;
  gridColorLines: string;
}

export interface MannequinSpec {
  baseDisc: { radius: number; heightY: number; centerY: number };
  post: { radius: number; halfHeightY: number; centerY: number };
  torso: { radius: number; cylinderLengthY: number; centerY: number };
  neck: { radius: number; halfHeightY: number; centerY: number };
  head: { radius: number; centerY: number };
  /** Face marker on the local +Z side; yaw 0 faces +Z per the convention. */
  faceMarker: { size: Vec3; offset: Vec3 };
  colorByCharacterId: { character_a: string; character_b: string };
}

export interface CharacterPlacement {
  id: ShotState["characters"][number]["id"];
  /** Copied verbatim from ShotState characters. */
  position: Vec3;
  /** Copied verbatim from ShotState characters (0 = facing +Z). */
  rotationYDeg: number;
}

export interface InspectionCameraSpec {
  name: "director-inspection-camera";
  position: Vec3;
  target: Vec3;
  fovDeg: number;
  near: number;
  far: number;
}

export interface StageProjection {
  aspectRatio: AspectRatio;
  room: RoomSpec;
  characters: CharacterPlacement[];
  shotCamera: ShotCameraDescriptor;
  /**
   * Movement start/end are projected completely but are NOT tweened in this
   * phase; the stage renders only the current camera pose.
   */
  movement: {
    type: ShotState["movement"]["type"];
    durationSeconds: number;
    easing: ShotState["movement"]["easing"];
    start: ShotCameraDescriptor;
    end: ShotCameraDescriptor;
  };
  inspectionCamera: InspectionCameraSpec;
}

/**
 * One generic dialogue room (decision D014). Interior 6 x 2.8 x 7 metres so
 * every current template camera pose (max z = 3.4) stays inside the room.
 */
export const DIALOGUE_ROOM: RoomSpec = {
  widthX: 6,
  depthZ: 7,
  wallHeightY: 2.8,
  centerX: 0,
  centerZ: 1,
  floorColor: "#8f8f8f",
  wallColor: "#c4c4c4",
  gridColorCenter: "#5f5f5f",
  gridColorLines: "#6e6e6e",
};

/**
 * Generic standing mannequin (dress-form style). Head is centred near the
 * 1.55m eyeline that all current templates target. Proportions are rendering
 * constants, not template data.
 */
export const MANNEQUIN: MannequinSpec = {
  baseDisc: { radius: 0.22, heightY: 0.04, centerY: 0.02 },
  post: { radius: 0.04, halfHeightY: 0.36, centerY: 0.4 },
  torso: { radius: 0.17, cylinderLengthY: 0.38, centerY: 1.12 },
  neck: { radius: 0.05, halfHeightY: 0.04, centerY: 1.5 },
  head: { radius: 0.11, centerY: 1.56 },
  faceMarker: { size: [0.05, 0.08, 0.02], offset: [0, 1.56, 0.115] },
  colorByCharacterId: { character_a: "#8a9aa8", character_b: "#a8908a" },
};

/**
 * The director inspection camera is a fixed, ShotState-independent viewpoint
 * used only by the director view so the shot camera and its frustum stay
 * visible. The camera view must never use it.
 */
export const DIRECTOR_INSPECTION_CAMERA: InspectionCameraSpec = {
  name: "director-inspection-camera",
  position: [2.7, 2.3, 4.1],
  target: [0, 1.1, 0.6],
  fovDeg: 50,
  near: 0.05,
  far: 60,
};

export function shotCameraDescriptor(
  camera: Pick<CameraState, "position" | "target" | "focalLengthMm">,
  aspectRatio: AspectRatio,
): ShotCameraDescriptor {
  return {
    position: [...camera.position] as Vec3,
    target: [...camera.target] as Vec3,
    focalLengthMm: camera.focalLengthMm,
    fovDeg: verticalFovDeg(camera.focalLengthMm, aspectRatio),
    near: SHOT_CAMERA_NEAR_M,
    far: SHOT_CAMERA_FAR_M,
  };
}

/**
 * Projects the canonical state into renderable scene data. Pure: mutating the
 * state afterwards never changes an existing projection.
 */
export function projectShotStateToStage(state: ShotState): StageProjection {
  if (state.scene.presetId !== "dialogue_room") {
    // scenePresetIdSchema is a literal; this guard documents the 1:1 mapping.
    throw new Error(`unsupported scene preset: ${state.scene.presetId}`);
  }
  return {
    aspectRatio: state.aspectRatio,
    room: DIALOGUE_ROOM,
    characters: state.characters.map((character) => ({
      id: character.id,
      position: [...character.position] as Vec3,
      rotationYDeg: character.rotationYDeg,
    })),
    shotCamera: shotCameraDescriptor(state.camera, state.aspectRatio),
    movement: {
      type: state.movement.type,
      durationSeconds: state.movement.durationSeconds,
      easing: state.movement.easing,
      start: shotCameraDescriptor(state.movement.start, state.aspectRatio),
      end: shotCameraDescriptor(state.movement.end, state.aspectRatio),
    },
    inspectionCamera: DIRECTOR_INSPECTION_CAMERA,
  };
}

/** Numeric aspect used by both the shot camera and the camera-view frame. */
export function aspectRatioToNumber(aspectRatio: AspectRatio): number {
  return aspectRatio === "16:9" ? 16 / 9 : 9 / 16;
}

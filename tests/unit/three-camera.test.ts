import { describe, expect, it } from "vitest";

import { Vector3, PerspectiveCamera } from "three";

import { createSequenceIdFactory } from "@/domain/ids";
import { createShotStateFromTemplate, type ShotState } from "@/domain/shot-state";
import {
  aspectRatioToNumber,
  projectShotStateToStage,
  type ShotCameraDescriptor,
} from "@/features/rendering/stage-projection";
import { applyShotCameraToPerspectiveCamera } from "@/features/rendering/three-camera";
import { loadRealTemplates } from "../helpers/content-test-utils";

async function otsDescriptor(): Promise<ShotCameraDescriptor> {
  const templates = await loadRealTemplates();
  const template = templates.find((candidate) => candidate.id === "dialogue_ots_a_to_b");
  if (template === undefined) {
    throw new Error("dialogue_ots_a_to_b missing from real content");
  }
  const state = createShotStateFromTemplate(template, {
    generateId: createSequenceIdFactory("shot"),
  });
  return projectShotStateToStage(state).shotCamera;
}

async function otsState(): Promise<ShotState> {
  const templates = await loadRealTemplates();
  const template = templates.find((candidate) => candidate.id === "dialogue_ots_a_to_b");
  if (template === undefined) {
    throw new Error("dialogue_ots_a_to_b missing from real content");
  }
  return createShotStateFromTemplate(template, {
    generateId: createSequenceIdFactory("shot"),
  });
}

function projectPoint(camera: PerspectiveCamera, point: [number, number, number]): Vector3 {
  camera.updateMatrixWorld();
  return new Vector3(point[0], point[1], point[2]).project(camera);
}

describe("applyShotCameraToPerspectiveCamera", () => {
  it("sets position, FOV, aspect and clip planes from the ShotState descriptor", async () => {
    const descriptor = await otsDescriptor();
    const camera = new PerspectiveCamera();
    applyShotCameraToPerspectiveCamera(camera, descriptor, aspectRatioToNumber("16:9"));

    expect(camera.position.x).toBeCloseTo(-1.25, 12);
    expect(camera.position.y).toBeCloseTo(1.7, 12);
    expect(camera.position.z).toBeCloseTo(2, 12);
    // Film-gate FOV for 75mm on a 16:9 36mm long-edge gate — not the focal value.
    expect(camera.fov).toBeCloseTo(15.376895539805746, 9);
    expect(camera.fov).not.toBe(50);
    expect(camera.aspect).toBeCloseTo(16 / 9, 12);
    expect(camera.near).toBe(descriptor.near);
    expect(camera.far).toBe(descriptor.far);
  });

  it("aims the camera at the ShotState target (lookAt direction)", async () => {
    const descriptor = await otsDescriptor();
    const camera = new PerspectiveCamera();
    applyShotCameraToPerspectiveCamera(camera, descriptor, aspectRatioToNumber("16:9"));

    camera.updateMatrixWorld();
    const direction = new Vector3();
    camera.getWorldDirection(direction);
    const expected = new Vector3(
      descriptor.target[0] - descriptor.position[0],
      descriptor.target[1] - descriptor.position[1],
      descriptor.target[2] - descriptor.position[2],
    ).normalize();
    expect(direction.x).toBeCloseTo(expected.x, 12);
    expect(direction.y).toBeCloseTo(expected.y, 12);
    expect(direction.z).toBeCloseTo(expected.z, 12);
  });

  it("refreshes the projection matrix (pinhole vertical identity)", async () => {
    const descriptor = await otsDescriptor();
    const camera = new PerspectiveCamera();
    applyShotCameraToPerspectiveCamera(camera, descriptor, aspectRatioToNumber("16:9"));

    const fovRad = (camera.fov * Math.PI) / 180;
    // For a perspective projection, m11 = 1 / tan(vfov / 2).
    expect(camera.projectionMatrix.elements[5]).toBeCloseTo(1 / Math.tan(fovRad / 2), 10);
  });

  it("re-applies cleanly when the descriptor changes (no cached truth)", async () => {
    const descriptor = await otsDescriptor();
    const moved: ShotCameraDescriptor = {
      ...descriptor,
      position: [2.5, 1.2, 3.3],
      target: [-0.8, 1.55, 0],
      fovDeg: 32.26880217111643, // 35mm 16:9
    };
    const camera = new PerspectiveCamera();
    applyShotCameraToPerspectiveCamera(camera, descriptor, aspectRatioToNumber("16:9"));
    applyShotCameraToPerspectiveCamera(camera, moved, aspectRatioToNumber("16:9"));

    expect(camera.position.toArray()).toEqual([2.5, 1.2, 3.3]);
    expect(camera.fov).toBeCloseTo(32.26880217111643, 9);
    camera.updateMatrixWorld();
    const direction = new Vector3();
    camera.getWorldDirection(direction);
    expect(direction.x).toBeLessThan(0); // target at negative X from positive-X position
  });

  it("frames the fixture exactly: character_b centered, character_a outside the 16:9 frame edge", async () => {
    // Ground truth for the rendered camera view (see docs/OPEN_QUESTIONS.md):
    // at the current engineering-mapped pose the OTS foreground shoulder
    // (character_a) falls outside the frame; the stage must render the
    // canonical numbers faithfully rather than "fix" the blocking.
    const state = await otsState();
    const camera = new PerspectiveCamera();
    applyShotCameraToPerspectiveCamera(
      camera,
      projectShotStateToStage(state).shotCamera,
      aspectRatioToNumber(state.aspectRatio),
    );

    const bHead = projectPoint(camera, [0.8, 1.56, 0]);
    expect(bHead.x).toBeCloseTo(0, 6); // look-at target sits at frame center
    expect(bHead.y).toBeCloseTo(0.0258, 3);
    expect(Math.abs(bHead.x)).toBeLessThan(1);

    const aHead = projectPoint(camera, [-0.8, 1.56, 0]);
    expect(aHead.x).toBeLessThan(-1); // outside the left frame edge
    const aShoulder = projectPoint(camera, [-0.6, 1.45, 0]);
    expect(aShoulder.x).toBeLessThan(-1);
  });
});

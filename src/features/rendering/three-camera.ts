/**
 * Three.js camera adapter at the feature/rendering boundary.
 *
 * Applies a ShotCameraDescriptor (produced by stage-projection.ts from
 * canonical ShotState) to a real THREE.PerspectiveCamera. No template, focal
 * or character truth may be defined here — only the mechanical application of
 * already-derived numbers.
 */
import { Vector3, type PerspectiveCamera } from "three";

import type { ShotCameraDescriptor } from "./stage-projection";

const scratchTarget = new Vector3();

export function applyShotCameraToPerspectiveCamera(
  camera: PerspectiveCamera,
  descriptor: ShotCameraDescriptor,
  aspect: number,
): void {
  camera.position.set(descriptor.position[0], descriptor.position[1], descriptor.position[2]);
  scratchTarget.set(descriptor.target[0], descriptor.target[1], descriptor.target[2]);
  camera.up.set(0, 1, 0);
  camera.lookAt(scratchTarget);
  camera.fov = descriptor.fovDeg;
  camera.aspect = aspect;
  camera.near = descriptor.near;
  camera.far = descriptor.far;
  camera.updateProjectionMatrix();
}

"use client";

/**
 * Static 3D director stage (Prompt 3 / Phase 1 Day 3).
 *
 * The Three.js scene below is a pure projection of the canonical ShotState
 * (see stage-projection.ts). This component defines no template, camera,
 * focal-length, character or movement truth of its own; it only owns
 * rendering mechanics: the WebGL canvas, fixed lights, view switching, a
 * readiness report and a scene snapshot for browser tests.
 *
 * Camera ownership: exactly ONE ShotState-derived PerspectiveCamera exists per
 * stage. In camera view it is passed to the Canvas as the initial camera
 * instance (no post-mount swap, so no frame can render through a wrong
 * camera); in director view it is mounted as a scene object with a visible
 * body and an accurate CameraHelper frustum while the fixed inspection camera
 * renders. The stage reports ready only after the active camera matches the
 * view's expectation.
 *
 * Determinism rules: fixed viewport layout, fixed colors/geometry/lights,
 * dpr=1, no auto-rotation, no randomness, no time-based animation.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";

import type { ShotState } from "@/domain/shot-state";
import { applyShotCameraToPerspectiveCamera } from "./three-camera";
import {
  aspectRatioToNumber,
  DIRECTOR_INSPECTION_CAMERA,
  MANNEQUIN,
  projectShotStateToStage,
  type CharacterPlacement,
  type StageProjection,
} from "./stage-projection";

export type DirectorStageView = "director" | "camera";

export const SHOT_CAMERA_NAME = "shot-camera";
export const SHOT_CAMERA_HELPER_NAME = "shot-camera-frustum";

/** Scene facts reported to the DOM once the correct camera is active. */
export interface StageSnapshot {
  view: DirectorStageView;
  activeCamera: {
    name: string;
    position: [number, number, number];
    fovDeg: number;
    worldDirection: [number, number, number];
  };
  mannequins: string[];
  shotCameraInScene: boolean;
  frustumHelperVisible: boolean;
  drawingBuffer: { width: number; height: number };
}

const STAGE_BACKGROUND = "#181a1e";

function Room({ projection }: { projection: StageProjection }) {
  const room = projection.room;
  return (
    <group name="dialogue-room-group">
      <mesh
        name="dialogue-room-shell"
        position={[room.centerX, room.wallHeightY / 2, room.centerZ]}
      >
        <boxGeometry args={[room.widthX, room.wallHeightY, room.depthZ]} />
        <meshStandardMaterial color={room.wallColor} side={THREE.BackSide} />
      </mesh>
      <mesh
        name="dialogue-room-floor"
        position={[room.centerX, 0.001, room.centerZ]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[room.widthX, room.depthZ]} />
        <meshStandardMaterial color={room.floorColor} />
      </mesh>
      <gridHelper
        name="dialogue-room-grid"
        args={[6, 6, room.gridColorCenter, room.gridColorLines]}
        position={[room.centerX, 0.002, room.centerZ]}
      />
    </group>
  );
}

function Mannequin({ placement }: { placement: CharacterPlacement }) {
  const spec = MANNEQUIN;
  const color = spec.colorByCharacterId[placement.id];
  return (
    <group
      name={`mannequin-${placement.id}`}
      position={placement.position}
      rotation-y={(placement.rotationYDeg * Math.PI) / 180}
    >
      <mesh position={[0, spec.baseDisc.centerY, 0]}>
        <cylinderGeometry
          args={[spec.baseDisc.radius, spec.baseDisc.radius, spec.baseDisc.heightY, 24]}
        />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, spec.post.centerY, 0]}>
        <cylinderGeometry
          args={[spec.post.radius, spec.post.radius, spec.post.halfHeightY * 2, 12]}
        />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, spec.torso.centerY, 0]}>
        <capsuleGeometry args={[spec.torso.radius, spec.torso.cylinderLengthY, 8, 24]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, spec.neck.centerY, 0]}>
        <cylinderGeometry
          args={[spec.neck.radius, spec.neck.radius, spec.neck.halfHeightY * 2, 12]}
        />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, spec.head.centerY, 0]}>
        <sphereGeometry args={[spec.head.radius, 24, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* Face marker on local +Z: yaw 0 faces +Z per the engineering convention. */}
      <mesh position={spec.faceMarker.offset}>
        <boxGeometry args={spec.faceMarker.size} />
        <meshStandardMaterial color="#2c2c2c" />
      </mesh>
    </group>
  );
}

/**
 * Reports the live scene state once, and only once the view's expected camera
 * is the active render camera — the readiness gate for browser tests.
 */
function StageReporter({
  view,
  shotCamera,
  onSnapshot,
}: {
  view: DirectorStageView;
  shotCamera: THREE.PerspectiveCamera;
  onSnapshot: (snapshot: StageSnapshot) => void;
}) {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const reported = useRef(false);
  useFrame(() => {
    if (reported.current) {
      return;
    }
    // Camera view must render through the ShotState camera; director view
    // through the fixed inspection camera. Defer until that is true.
    if (view === "camera" && camera !== shotCamera) {
      return;
    }
    if (view === "director" && camera.name !== DIRECTOR_INSPECTION_CAMERA.name) {
      return;
    }
    reported.current = true;
    const direction = new THREE.Vector3();
    camera.updateMatrixWorld();
    camera.getWorldDirection(direction);
    // The stage only ever uses perspective cameras (inspection or shot camera).
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const shotCameraObject = scene.getObjectByName(SHOT_CAMERA_NAME);
    const helper = scene.getObjectByName(SHOT_CAMERA_HELPER_NAME);
    const mannequins: string[] = [];
    scene.traverse((object) => {
      if (object.name.startsWith("mannequin-character_")) {
        mannequins.push(object.name.replace("mannequin-", ""));
      }
    });
    onSnapshot({
      view,
      activeCamera: {
        name: camera.name,
        position: [camera.position.x, camera.position.y, camera.position.z],
        fovDeg: perspectiveCamera.fov,
        worldDirection: [direction.x, direction.y, direction.z],
      },
      mannequins,
      shotCameraInScene: shotCameraObject !== undefined,
      frustumHelperVisible: helper !== undefined && helper.visible,
      drawingBuffer: { width: gl.domElement.width, height: gl.domElement.height },
    });
  });
  return null;
}

function StageContent({
  projection,
  view,
  shotCamera,
  onSnapshot,
}: {
  projection: StageProjection;
  view: DirectorStageView;
  shotCamera: THREE.PerspectiveCamera;
  onSnapshot: (snapshot: StageSnapshot) => void;
}) {
  const helper = useMemo(() => {
    if (view !== "director") {
      return null;
    }
    const helper = new THREE.CameraHelper(shotCamera);
    helper.name = SHOT_CAMERA_HELPER_NAME;
    helper.update();
    return helper;
  }, [view, shotCamera]);

  return (
    <>
      <color attach="background" args={[STAGE_BACKGROUND]} />
      <ambientLight intensity={1.05} />
      <directionalLight position={[2, 3, 3]} intensity={1.15} />
      <Room projection={projection} />
      {projection.characters.map((placement) => (
        <Mannequin key={placement.id} placement={placement} />
      ))}
      {view === "director" && (
        <>
          <primitive object={shotCamera}>
            <mesh name="shot-camera-body">
              <boxGeometry args={[0.12, 0.09, 0.2]} />
              <meshStandardMaterial color="#303036" />
            </mesh>
            <mesh name="shot-camera-lens" position={[0, 0, -0.13]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.035, 0.035, 0.08, 16]} />
              <meshStandardMaterial color="#1c1c20" />
            </mesh>
          </primitive>
          {helper !== null && <primitive object={helper} />}
        </>
      )}
      <StageReporter view={view} shotCamera={shotCamera} onSnapshot={onSnapshot} />
    </>
  );
}

export function DirectorStage({
  shotState,
  view,
}: {
  shotState: ShotState;
  view: DirectorStageView;
}) {
  const projection = useMemo(() => projectShotStateToStage(shotState), [shotState]);
  // The single ShotState-derived camera for this stage, shared by both views.
  const shotCamera = useMemo(() => {
    const camera = new THREE.PerspectiveCamera();
    camera.name = SHOT_CAMERA_NAME;
    applyShotCameraToPerspectiveCamera(
      camera,
      projection.shotCamera,
      aspectRatioToNumber(projection.aspectRatio),
    );
    return camera;
  }, [projection]);
  const [snapshot, setSnapshot] = useState<StageSnapshot | null>(null);
  const frameStyle =
    view === "camera" ? { aspectRatio: projection.aspectRatio.replace(":", " / ") } : undefined;

  return (
    <div
      className="director-stage"
      data-active-view={view}
      data-stage-ready={snapshot !== null ? "true" : "false"}
      data-snapshot-view={snapshot?.view ?? "pending"}
    >
      <div className="director-stage-area">
        <div
          className={
            view === "camera"
              ? "director-stage-frame director-stage-frame-camera"
              : "director-stage-frame"
          }
          style={frameStyle}
        >
          <Canvas
            key={view}
            dpr={1}
            gl={{ antialias: true }}
            camera={
              view === "camera"
                ? // The shot camera instance is the initial render camera:
                  // no frame can be produced through any other camera.
                  shotCamera
                : {
                    position: [...DIRECTOR_INSPECTION_CAMERA.position],
                    fov: DIRECTOR_INSPECTION_CAMERA.fovDeg,
                    near: DIRECTOR_INSPECTION_CAMERA.near,
                    far: DIRECTOR_INSPECTION_CAMERA.far,
                  }
            }
            onCreated={
              view === "director"
                ? ({ camera }) => {
                    camera.name = DIRECTOR_INSPECTION_CAMERA.name;
                    camera.lookAt(
                      DIRECTOR_INSPECTION_CAMERA.target[0],
                      DIRECTOR_INSPECTION_CAMERA.target[1],
                      DIRECTOR_INSPECTION_CAMERA.target[2],
                    );
                  }
                : undefined
            }
          >
            <StageContent
              projection={projection}
              view={view}
              shotCamera={shotCamera}
              onSnapshot={setSnapshot}
            />
          </Canvas>
        </div>
      </div>
      <script type="application/json" data-testid="stage-snapshot">
        {snapshot === null ? "" : JSON.stringify(snapshot)}
      </script>
    </div>
  );
}

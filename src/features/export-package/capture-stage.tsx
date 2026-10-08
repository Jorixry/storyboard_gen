"use client";

/**
 * Hidden readiness-gated capture stage (Prompt 5; extracted for reuse by the
 * Prompt 8 full export — behavior unchanged).
 *
 * Renders one pose at a time in camera view and PNG-encodes each frame only
 * after the stage's deterministic readiness snapshot numerically matches that
 * pose (position AND orientation AND FOV AND the exact export raster — see
 * capture-readiness.ts). Rendered off-screen at the exact export resolution;
 * a lost WebGL context surfaces as an error, not a hang.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { exportImageDimensions } from "@/domain/artifacts";
import type { CameraPose } from "@/domain/schemas";
import type { ShotState } from "@/domain/shot-state";
import { DirectorStage, type StageSnapshot } from "@/features/rendering/DirectorStage";

import { poseMatchesSnapshot } from "./capture-readiness";

const CAPTURE_TIMEOUT_MS = 30_000;

export interface CapturedPoseImages {
  compositionRaw: Uint8Array;
  movementStart: Uint8Array;
  movementEnd: Uint8Array;
}

export function PoseCaptureStage({
  frozen,
  onComplete,
  onError,
}: {
  frozen: ShotState;
  onComplete: (images: CapturedPoseImages) => void;
  onError: (message: string) => void;
}) {
  const poses = useMemo(
    () => [frozen.camera, frozen.movement.start, frozen.movement.end] as CameraPose[],
    [frozen],
  );
  const [poseIndex, setPoseIndex] = useState(0);
  const [snapshot, setSnapshot] = useState<StageSnapshot | null>(null);
  const capturedIndexes = useRef<Set<number>>(new Set());
  const capturedImages = useRef<Uint8Array[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dimensions = exportImageDimensions(frozen.aspectRatio);
  const pose = poses[poseIndex];

  // Watchdog: a lost WebGL context must surface as an error, not a hang.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onError(`camera-view capture for pose ${poseIndex} did not become ready in time`);
    }, CAPTURE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [poseIndex, onError]);

  useEffect(() => {
    if (snapshot === null || !poseMatchesSnapshot(pose, frozen.aspectRatio, dimensions, snapshot)) {
      return;
    }
    if (capturedIndexes.current.has(poseIndex)) {
      return;
    }
    capturedIndexes.current.add(poseIndex);
    const canvas = containerRef.current?.querySelector("canvas");
    if (canvas === null || canvas === undefined) {
      onError("capture canvas was not found");
      return;
    }
    canvas.toBlob((blob) => {
      if (blob === null) {
        onError("PNG encoding of the captured frame failed");
        return;
      }
      void blob.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        if (poseIndex === poses.length - 1) {
          const images: CapturedPoseImages = {
            compositionRaw: capturedImages.current[0]!,
            movementStart: capturedImages.current[1]!,
            movementEnd: bytes,
          };
          capturedImages.current = [];
          capturedIndexes.current = new Set();
          onComplete(images);
        } else {
          capturedImages.current.push(bytes);
          setPoseIndex(poseIndex + 1);
        }
      });
    }, "image/png");
  }, [snapshot, pose, poseIndex, poses.length, frozen, dimensions, onComplete, onError]);

  return (
    <div
      ref={containerRef}
      className="raw-export-capture-stage"
      data-testid="raw-export-capture-stage"
      style={{ width: dimensions.width, height: dimensions.height }}
      aria-hidden="true"
    >
      <DirectorStage
        shotState={frozen}
        view="camera"
        cameraPoseOverride={pose}
        onSnapshot={setSnapshot}
      />
    </div>
  );
}

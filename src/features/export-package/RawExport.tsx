"use client";

/**
 * Raw export UI and capture orchestration (Prompt 5 / Phase 1 Day 5).
 *
 * Flow (all client-side, no server call, no provider):
 * 1. One-time validation freeze: the live canonical ShotState is parsed with
 *    the canonical Zod schema exactly once per export; every later step reads
 *    the frozen snapshot only (edits during capture cannot leak in).
 * 2. A hidden, fixed-resolution camera-view stage (16:9 -> 1280x720,
 *    9:16 -> 720x1280, dpr=1) renders the frozen snapshot's CURRENT camera
 *    and the movement START and END poses; each capture is gated by the
 *    stage's deterministic readiness snapshot before canvas.toBlob().
 * 3. buildRawExportPackage() (pure) assembles the five-file STORE ZIP with a
 *    versioned, hash-covering manifest; the archive downloads via a temporary
 *    object URL.
 *
 * Boundary rules: blobs, canvases, ZIP bytes and progress live ONLY in this
 * component's local state during an export; nothing enters the store or
 * localStorage; no prompt, enhanced frame or provider artifact is produced.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand/react";

import { exportImageDimensions } from "@/domain/artifacts";
import type { CameraPose } from "@/domain/schemas";
import { shotStateSchema, type ShotState } from "@/domain/shot-state";
import { verticalFovDeg } from "@/domain/camera-math";
import {
  DirectorStage,
  SHOT_CAMERA_NAME,
  type StageSnapshot,
} from "@/features/rendering/DirectorStage";
import { appShotStore } from "@/state/app-shot-store";

import { buildRawExportPackage, type RawExportImages } from "./raw-export-package";

const CAPTURE_TIMEOUT_MS = 30_000;
/** Long enough for any browser download pipeline to drain the blob URL. */
const OBJECT_URL_RELEASE_DELAY_MS = 30_000;

type ExportPhase = "idle" | "capturing" | "packaging" | "done" | "error";

const PHASE_COPY: Record<ExportPhase, string> = {
  idle: "",
  capturing: "正在按冻结的 ShotState 快照渲染 current / start / end 相机视图…",
  packaging: "正在生成 manifest 与 raw ZIP…",
  done: "",
  error: "",
};

function matchesPose(snapshot: StageSnapshot, pose: CameraPose, expectedFovDeg: number): boolean {
  if (snapshot.activeCamera.name !== SHOT_CAMERA_NAME) {
    return false;
  }
  const [x, y, z] = snapshot.activeCamera.position;
  return (
    Math.abs(x - pose.position[0]) < 1e-6 &&
    Math.abs(y - pose.position[1]) < 1e-6 &&
    Math.abs(z - pose.position[2]) < 1e-6 &&
    Math.abs(snapshot.activeCamera.fovDeg - expectedFovDeg) < 1e-6
  );
}

/**
 * Hidden capture stage: renders one pose at a time in camera view and PNG-
 * encodes each frame only after the readiness snapshot numerically matches
 * that pose. Rendered off-screen at the exact export resolution.
 */
function ExportCaptureStage({
  frozen,
  onComplete,
  onError,
}: {
  frozen: ShotState;
  onComplete: (images: RawExportImages) => void;
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
  const expectedFovDeg = verticalFovDeg(pose.focalLengthMm, frozen.aspectRatio);

  // Watchdog: a lost WebGL context must surface as an error, not a hang.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onError(`camera-view capture for pose ${poseIndex} did not become ready in time`);
    }, CAPTURE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [poseIndex, onError]);

  useEffect(() => {
    if (snapshot === null || !matchesPose(snapshot, pose, expectedFovDeg)) {
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
          const images = {
            compositionRaw: capturedImages.current[0],
            movementStart: capturedImages.current[1],
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
  }, [snapshot, pose, poseIndex, poses.length, expectedFovDeg, onComplete, onError]);

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

export function RawExport() {
  const shotState = useStore(appShotStore, (state) => state.shotState);
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [frozen, setFrozen] = useState<ShotState | null>(null);
  const [status, setStatus] = useState("");

  const busy = phase === "capturing" || phase === "packaging";

  const startExport = () => {
    if (shotState === null || busy) {
      return;
    }
    const parsed = shotStateSchema.safeParse(shotState);
    if (!parsed.success) {
      setPhase("error");
      setStatus(`ShotState 校验失败，导出被拒绝：${parsed.error.message}`);
      return;
    }
    setFrozen(parsed.data);
    setPhase("capturing");
    setStatus(PHASE_COPY.capturing);
  };

  const handleCaptured = async (snapshotState: ShotState, images: RawExportImages) => {
    setPhase("packaging");
    setStatus(PHASE_COPY.packaging);
    try {
      const pkg = await buildRawExportPackage(snapshotState, images, new Date());
      const blob = new Blob([pkg.zip as BlobPart], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = pkg.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_RELEASE_DELAY_MS);
      setPhase("done");
      setStatus(`已生成 ${pkg.fileName}（5 个文件 · ${pkg.zip.byteLength} bytes）`);
    } catch (error) {
      setPhase("error");
      setStatus(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setFrozen(null);
    }
  };

  const handleCaptureError = (message: string) => {
    setPhase("error");
    setStatus(`导出失败：${message}`);
    setFrozen(null);
  };

  return (
    <section className="raw-export" data-testid="raw-export" aria-label="导出">
      <h3>导出（raw export）</h3>
      <p className="control-hint">
        raw ZIP 仅包含：shot-state.json、composition-raw.png、movement-start.png、
        movement-end.png、manifest.json。不含 AI 生成内容，不调用任何外部服务。
      </p>
      <div className="control-group">
        <button
          type="button"
          data-testid="export-raw-zip"
          disabled={shotState === null || busy}
          onClick={startExport}
        >
          {busy ? "导出中…" : "导出 raw ZIP"}
        </button>
      </div>
      <p className="control-hint" data-testid="export-status" hidden={status === ""}>
        {status}
      </p>
      {phase === "capturing" && frozen !== null && (
        <ExportCaptureStage
          frozen={frozen}
          onComplete={(images) => void handleCaptured(frozen, images)}
          onError={handleCaptureError}
        />
      )}
    </section>
  );
}

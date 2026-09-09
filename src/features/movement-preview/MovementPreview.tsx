"use client";

/**
 * Movement tween preview (Prompt 5 / Phase 1 Day 5).
 *
 * Reads the ONE start pose and ONE end pose from the canonical ShotState and
 * previews the deterministic interpolation (src/domain/movement.ts) by
 * passing the interpolated pose up as an ephemeral camera-view override for
 * the director stage.
 *
 * Boundary rules:
 * - preview progress (`enabled`, `progress`) and the play animation are
 *   temporary UI state owned by the page — NEVER store/localStorage content
 *   and never part of ShotState;
 * - the component dispatches no store commands: it cannot edit movement,
 *   camera or characters (movement editing is out of Prompt 5 scope);
 * - the exported package always uses the canonical current camera plus the
 *   start/end poses, regardless of any preview position.
 */
import { useEffect, useRef, useState } from "react";

import { interpolateCameraPose } from "@/domain/movement";
import type { ShotState } from "@/domain/shot-state";

export interface MovementPreviewUiState {
  enabled: boolean;
  progress: number;
}

function formatVec3(values: readonly number[]): string {
  return values.map((value) => value.toFixed(2)).join(", ");
}

export function MovementPreview({
  shotState,
  preview,
  onPreviewChange,
}: {
  shotState: ShotState;
  preview: MovementPreviewUiState;
  onPreviewChange: (next: MovementPreviewUiState) => void;
}) {
  const { movement } = shotState;
  const [playing, setPlaying] = useState(false);
  const progressRef = useRef(preview.progress);
  // Keep the ref current outside render (react-hooks/refs); the play effect
  // below reads it once, at the moment playback starts.
  useEffect(() => {
    progressRef.current = preview.progress;
  }, [preview.progress]);

  // Play = requestAnimationFrame scrub from the current progress to t=1 over
  // the movement's duration. Purely ephemeral: each frame updates the page's
  // preview state, nothing else.
  useEffect(() => {
    if (!playing) {
      return;
    }
    const startProgress = progressRef.current >= 1 ? 0 : progressRef.current;
    const span = 1 - startProgress;
    if (span <= 0) {
      onPreviewChange({ enabled: true, progress: 1 });
      setPlaying(false);
      return;
    }
    const durationMs = movement.durationSeconds * 1000;
    const startedAt = performance.now();
    let frame = 0;
    const tick = () => {
      const elapsed = (performance.now() - startedAt) / durationMs;
      const next = Math.min(startProgress + span * elapsed, 1);
      onPreviewChange({ enabled: true, progress: next });
      if (next >= 1) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, movement.durationSeconds, onPreviewChange]);

  const interpolated = interpolateCameraPose(movement, preview.progress);

  return (
    <section className="movement-preview" data-testid="movement-preview" aria-label="运镜预览">
      <h3>运镜预览（movement preview）</h3>
      <p className="movement-summary" data-testid="movement-summary">
        {movement.type} · {movement.durationSeconds}s · {movement.easing} · 一个 start pose + 一个
        end pose
      </p>
      <div className="control-group">
        <button
          type="button"
          data-testid="preview-toggle"
          aria-pressed={preview.enabled}
          onClick={() => {
            setPlaying(false);
            onPreviewChange({ enabled: !preview.enabled, progress: preview.progress });
          }}
        >
          {preview.enabled ? "关闭运镜预览" : "在 Camera view 预览运镜"}
        </button>
        <button
          type="button"
          data-testid="preview-play"
          disabled={!preview.enabled}
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? "停止" : "播放"}
        </button>
      </div>
      <div className="movement-preview-slider">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={preview.progress}
          data-testid="movement-progress"
          aria-label={`运镜进度 t（0=起点，1=终点，当前 ${preview.progress.toFixed(2)}）`}
          disabled={!preview.enabled}
          onChange={(event) => {
            setPlaying(false);
            const next = Number(event.target.value);
            if (Number.isFinite(next)) {
              onPreviewChange({ enabled: true, progress: next });
            }
          }}
        />
        <span data-testid="preview-progress-label">t={preview.progress.toFixed(2)}</span>
      </div>
      <p className="control-hint" data-testid="preview-pose-readout">
        插值相机 camera [{formatVec3(interpolated.position)}] ·{" "}
        {interpolated.focalLengthMm.toFixed(0)}
        mm（目标 [{formatVec3(interpolated.target)}]）
      </p>
      <p className="control-hint" data-testid="preview-current-camera">
        当前构图（canonical，不变）：camera [{formatVec3(shotState.camera.position)}] ·{" "}
        {shotState.camera.focalLengthMm.toFixed(0)}mm
      </p>
      <p className="control-hint">
        预览是临时 UI 状态：不写入项目、不参与导出。导出固定使用当前构图 + start/end 两个 pose。
      </p>
    </section>
  );
}

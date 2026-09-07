"use client";

/**
 * Novice-friendly simple semantic controls (Prompt 4 / Phase 1 Day 4).
 *
 * Every button dispatches ONE typed, framework-independent domain command
 * against the single canonical ShotState — never a prompt string, never a
 * template mutation. The camera view preview updates because the stage
 * projects whatever the canonical state now says.
 */
import { useStore } from "zustand/react";

import type { AspectRatio } from "@/domain/schemas";
import { FOCAL_FEEL_PRESETS, type FocalFeelPresetId } from "@/domain/engineering-constraints";
import { appShotStore } from "@/state/app-shot-store";

const FOCAL_FEEL_LABELS: Record<FocalFeelPresetId, string> = {
  wide: "广角感 24mm",
  natural: "自然 35mm",
  portrait: "人像感 50mm",
  compressed: "压缩感 85mm",
};

function commit(action: () => void, onWarning: (message: string) => void): void {
  try {
    action();
    onWarning("");
  } catch (error) {
    // Command refused (invalid input / degenerate geometry / overlap):
    // the canonical state is untouched; surface the reason instead.
    onWarning(error instanceof Error ? error.message : String(error));
  }
}

export function SimpleControls({ onWarning }: { onWarning: (message: string) => void }) {
  const shotState = useStore(appShotStore, (state) => state.shotState);
  const makeCloser = useStore(appShotStore, (state) => state.makeCloser);
  const makeFarther = useStore(appShotStore, (state) => state.makeFarther);
  const emphasizeCharacter = useStore(appShotStore, (state) => state.emphasizeCharacter);
  const setFocalFeel = useStore(appShotStore, (state) => state.setFocalFeel);
  const setAspectRatio = useStore(appShotStore, (state) => state.setAspectRatio);
  const resetToTemplate = useStore(appShotStore, (state) => state.resetToTemplate);

  if (shotState === null) {
    return null;
  }
  const activeAspect: AspectRatio = shotState.aspectRatio;

  return (
    <section className="simple-controls" data-testid="simple-controls" aria-label="简单调整">
      <h3>简单调整</h3>
      <div className="control-group" data-testid="control-group-distance">
        <span className="control-group-label">景别远近</span>
        <button
          type="button"
          data-testid="control-closer"
          onClick={() => commit(makeCloser, onWarning)}
        >
          更近
        </button>
        <button
          type="button"
          data-testid="control-farther"
          onClick={() => commit(makeFarther, onWarning)}
        >
          更远
        </button>
      </div>
      <div className="control-group" data-testid="control-group-emphasis">
        <span className="control-group-label">强调角色</span>
        <button
          type="button"
          data-testid="control-emphasize-a"
          onClick={() => commit(() => emphasizeCharacter("character_a"), onWarning)}
        >
          强调角色 A
        </button>
        <button
          type="button"
          data-testid="control-emphasize-b"
          onClick={() => commit(() => emphasizeCharacter("character_b"), onWarning)}
        >
          强调角色 B
        </button>
      </div>
      <div className="control-group" data-testid="control-group-focal">
        <span className="control-group-label">焦距感觉</span>
        {(Object.keys(FOCAL_FEEL_PRESETS) as FocalFeelPresetId[]).map((preset) => (
          <button
            key={preset}
            type="button"
            data-testid={`control-focal-${preset}`}
            aria-pressed={shotState.camera.focalLengthMm === FOCAL_FEEL_PRESETS[preset]}
            onClick={() => commit(() => setFocalFeel(preset), onWarning)}
          >
            {FOCAL_FEEL_LABELS[preset]}
          </button>
        ))}
        <span className="control-hint">
          当前 {shotState.camera.focalLengthMm}mm · 预设为临时工程值（provisional engineering
          presets），非导演批准规则
        </span>
      </div>
      <div className="control-group" data-testid="control-group-aspect">
        <span className="control-group-label">画幅</span>
        {(["16:9", "9:16"] as const).map((ratio) => (
          <button
            key={ratio}
            type="button"
            data-testid={`control-aspect-${ratio.replace(":", "")}`}
            aria-pressed={activeAspect === ratio}
            onClick={() => commit(() => setAspectRatio(ratio), onWarning)}
          >
            {ratio === "16:9" ? "16:9 横屏" : "9:16 竖屏"}
          </button>
        ))}
      </div>
      <div className="control-group" data-testid="control-group-reset">
        <button
          type="button"
          data-testid="control-reset"
          onClick={() => commit(resetToTemplate, onWarning)}
        >
          恢复模板默认（reset to template）
        </button>
      </div>
    </section>
  );
}

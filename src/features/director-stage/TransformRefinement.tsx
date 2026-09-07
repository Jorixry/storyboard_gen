"use client";

/**
 * Optional constrained 3D refinement (Prompt 4 / Phase 1 Day 4).
 *
 * Progressive disclosure: the panel is a closed <details> element by default;
 * users must explicitly expand it. Only the whitelisted constrained
 * transforms exist (camera position/target, focal length, character
 * position/yaw) — there is deliberately no object creation/deletion, model
 * import, posing, material/lighting editor, timeline or movement editing.
 *
 * Every edit writes the SAME canonical ShotState through the same typed
 * domain commands as the simple controls, clamped to the provisional
 * engineering constraints. Refused commands leave the state untouched and
 * show the reason.
 */
import { useStore } from "zustand/react";

import type { CharacterId, Vec3 } from "@/domain/schemas";
import {
  CAMERA_POSITION_X_RANGE_M,
  CAMERA_POSITION_Y_RANGE_M,
  CAMERA_POSITION_Z_RANGE_M,
  CHARACTER_POSITION_X_RANGE_M,
  CHARACTER_POSITION_Z_RANGE_M,
} from "@/domain/engineering-constraints";
import { appShotStore } from "@/state/app-shot-store";

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function NumberField({
  label,
  unit,
  value,
  onCommit,
  testId,
  min,
  max,
  step,
  rangeNote,
}: {
  label: string;
  /** Physical unit shown next to the field, e.g. "m", "mm", "°". */
  unit: string;
  value: number;
  onCommit: (next: number) => void;
  testId: string;
  min: number;
  max: number;
  step: number;
  /** Optional provenance note appended to the displayed numeric range. */
  rangeNote?: string;
}) {
  return (
    <label className="number-field">
      <span className="number-field-label">{label}</span>
      <input
        type="number"
        data-testid={testId}
        aria-label={`${label}（单位 ${unit}，允许范围 ${formatNumber(min)} 至 ${formatNumber(max)}${rangeNote ? `，${rangeNote}` : ""}）`}
        value={formatNumber(value)}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          if (event.target.value === "") {
            return;
          }
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) {
            onCommit(parsed);
          }
        }}
      />
      <span className="number-field-range" data-testid={`${testId}-range`}>
        {unit} · {formatNumber(min)}–{formatNumber(max)}
        {rangeNote ? `（${rangeNote}）` : ""}
      </span>
    </label>
  );
}

export function TransformRefinement({ onWarning }: { onWarning: (message: string) => void }) {
  const shotState = useStore(appShotStore, (state) => state.shotState);
  const setCameraPosition = useStore(appShotStore, (state) => state.setCameraPosition);
  const setCameraTarget = useStore(appShotStore, (state) => state.setCameraTarget);
  const setCameraFocalLength = useStore(appShotStore, (state) => state.setCameraFocalLength);
  const setCharacterPosition = useStore(appShotStore, (state) => state.setCharacterPosition);
  const setCharacterYaw = useStore(appShotStore, (state) => state.setCharacterYaw);

  if (shotState === null) {
    return null;
  }
  const camera = shotState.camera;
  const characterOf = (id: CharacterId) =>
    shotState.characters.find((character) => character.id === id)!;

  const commitVec3 = (
    apply: (next: Vec3) => void,
    current: Vec3,
    index: number,
    parsed: number,
  ) => {
    const next = [...current] as Vec3;
    next[index] = parsed;
    try {
      apply(next);
      onWarning("");
    } catch (error) {
      onWarning(error instanceof Error ? error.message : String(error));
    }
  };

  const characterA = characterOf("character_a");
  const characterB = characterOf("character_b");

  return (
    <details className="transform-refinement" data-testid="advanced-refinement">
      <summary>高级 3D 调整（可选，默认收起）</summary>
      <div className="transform-refinement-body">
        <p className="control-hint">
          受临时工程约束（provisional engineering constraints）限制的数值编辑，范围由房间边界与内容
          Schema 推导，非导演批准范围。超出范围的数值将被收拢（clamp）。
        </p>
        <fieldset className="refinement-group" data-testid="refinement-camera">
          <legend>相机</legend>
          <div className="number-field-row">
            <NumberField
              label="位置 x"
              unit="m"
              value={camera.position[0]}
              min={CAMERA_POSITION_X_RANGE_M.min}
              max={CAMERA_POSITION_X_RANGE_M.max}
              step={0.05}
              testId="input-camera-position-x"
              onCommit={(next) => commitVec3(setCameraPosition, camera.position, 0, next)}
            />
            <NumberField
              label="位置 y"
              unit="m"
              value={camera.position[1]}
              min={CAMERA_POSITION_Y_RANGE_M.min}
              max={CAMERA_POSITION_Y_RANGE_M.max}
              step={0.05}
              testId="input-camera-position-y"
              onCommit={(next) => commitVec3(setCameraPosition, camera.position, 1, next)}
            />
            <NumberField
              label="位置 z"
              unit="m"
              value={camera.position[2]}
              min={CAMERA_POSITION_Z_RANGE_M.min}
              max={CAMERA_POSITION_Z_RANGE_M.max}
              step={0.05}
              testId="input-camera-position-z"
              onCommit={(next) => commitVec3(setCameraPosition, camera.position, 2, next)}
            />
          </div>
          <div className="number-field-row">
            <NumberField
              label="目标 x"
              unit="m"
              value={camera.target[0]}
              min={CAMERA_POSITION_X_RANGE_M.min}
              max={CAMERA_POSITION_X_RANGE_M.max}
              step={0.05}
              testId="input-camera-target-x"
              onCommit={(next) => commitVec3(setCameraTarget, camera.target, 0, next)}
            />
            <NumberField
              label="目标 y"
              unit="m"
              value={camera.target[1]}
              min={CAMERA_POSITION_Y_RANGE_M.min}
              max={CAMERA_POSITION_Y_RANGE_M.max}
              step={0.05}
              testId="input-camera-target-y"
              onCommit={(next) => commitVec3(setCameraTarget, camera.target, 1, next)}
            />
            <NumberField
              label="目标 z"
              unit="m"
              value={camera.target[2]}
              min={CAMERA_POSITION_Z_RANGE_M.min}
              max={CAMERA_POSITION_Z_RANGE_M.max}
              step={0.05}
              testId="input-camera-target-z"
              onCommit={(next) => commitVec3(setCameraTarget, camera.target, 2, next)}
            />
          </div>
          <NumberField
            label="焦距"
            unit="mm"
            rangeNote="Schema 范围"
            value={camera.focalLengthMm}
            min={12}
            max={200}
            step={1}
            testId="input-camera-focal-length"
            onCommit={(next) => {
              try {
                setCameraFocalLength(next);
                onWarning("");
              } catch (error) {
                onWarning(error instanceof Error ? error.message : String(error));
              }
            }}
          />
        </fieldset>
        {(["character_a", "character_b"] as const).map((id) => {
          const character = id === "character_a" ? characterA : characterB;
          const label = id === "character_a" ? "角色 A" : "角色 B";
          return (
            <fieldset className="refinement-group" key={id} data-testid={`refinement-${id}`}>
              <legend>{label}</legend>
              <div className="number-field-row">
                <NumberField
                  label="位置 x"
                  unit="m"
                  value={character.position[0]}
                  min={CHARACTER_POSITION_X_RANGE_M.min}
                  max={CHARACTER_POSITION_X_RANGE_M.max}
                  step={0.05}
                  testId={`input-${id}-position-x`}
                  onCommit={(next) =>
                    commitVec3(setCharacterPosition.bind(null, id), character.position, 0, next)
                  }
                />
                <NumberField
                  label="位置 z"
                  unit="m"
                  value={character.position[2]}
                  min={CHARACTER_POSITION_Z_RANGE_M.min}
                  max={CHARACTER_POSITION_Z_RANGE_M.max}
                  step={0.05}
                  testId={`input-${id}-position-z`}
                  onCommit={(next) =>
                    commitVec3(setCharacterPosition.bind(null, id), character.position, 2, next)
                  }
                />
                <NumberField
                  label="朝向角"
                  unit="°"
                  rangeNote="自动归一"
                  value={character.rotationYDeg}
                  min={-180}
                  max={180}
                  step={5}
                  testId={`input-${id}-yaw`}
                  onCommit={(next) => {
                    try {
                      setCharacterYaw(id, next);
                      onWarning("");
                    } catch (error) {
                      onWarning(error instanceof Error ? error.message : String(error));
                    }
                  }}
                />
              </div>
            </fieldset>
          );
        })}
      </div>
    </details>
  );
}

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
 * domain commands as the simple controls. Out-of-range drafts are gated at
 * the field: they stay visible, never reach the commands, and warn
 * persistently until corrected (2026-10-11 director-approved UX; yaw keeps
 * its wrap-into-range 自动归一 behavior). The commands still clamp as a
 * defense-in-depth layer, and refused commands leave the state untouched
 * and show the reason.
 *
 * Draft lifecycle (Prompt 8 acceptance fix R2, 2026-10-14): a held draft is
 * invalidated by exactly two events — the canonical-state lifecycle epoch
 * changing (template switch or reset-to-template, which keeps the shot ID)
 * or THIS field's canonical value changing from elsewhere (e.g. a simple
 * focal preset). An unrelated field's edit never clears a draft that is
 * still being corrected, and the invalid-draft behavior above is unchanged.
 */
import { useState, type ComponentProps } from "react";
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
  onWarning,
  testId,
  min,
  max,
  step,
  rangeNote,
  outOfRangePolicy = "reject",
  lifecycleEpoch,
}: {
  label: string;
  /** Physical unit shown next to the field, e.g. "m", "mm", "°". */
  unit: string;
  value: number;
  onCommit: (next: number) => void;
  /** Panel-level warning channel (shared slot; the field keeps its own persistent warning). */
  onWarning: (message: string) => void;
  testId: string;
  min: number;
  max: number;
  step: number;
  /** Optional provenance note appended to the displayed numeric range. */
  rangeNote?: string;
  /**
   * "reject" (default): out-of-range input stays in the field and never
   * reaches the canonical state. "commit": any FINITE value is committed and
   * the domain command transforms it (yaw wraps into [-180, 180] — the
   * 自动归一 promise on the field).
   */
  outOfRangePolicy?: "reject" | "commit";
  /**
   * Canonical-state lifecycle epoch (R2): changes when the whole state is
   * replaced by a template switch or reset. Any held draft is invalidated.
   */
  lifecycleEpoch: number;
}) {
  // 2026-10-11 director-approved UX: an out-of-range (or non-numeric) draft
  // STAYS in the input and is never written to the canonical ShotState — the
  // domain commands keep the last valid value. The warning persists until the
  // user returns the field to the allowed range and the commit succeeds.
  const [draft, setDraft] = useState<string | null>(null);
  const [fieldWarning, setFieldWarning] = useState("");

  // Draft lifecycle (R2, 2026-10-14): reset the held draft DURING RENDER when
  // the canonical lifecycle epoch or THIS field's canonical value moved. The
  // canonical value only changes while a draft is held when the update came
  // from OUTSIDE this field (its own valid commits clear the draft first), so
  // any change here means the draft no longer describes the state. The shared
  // panel warning is cleared by the same lifecycle paths (gallery select,
  // simple-control commits), so only the field-local warning resets here.
  const [seenEpoch, setSeenEpoch] = useState(lifecycleEpoch);
  const [seenValue, setSeenValue] = useState(value);
  if (lifecycleEpoch !== seenEpoch || value !== seenValue) {
    setSeenEpoch(lifecycleEpoch);
    setSeenValue(value);
    if (draft !== null || fieldWarning !== "") {
      setDraft(null);
      setFieldWarning("");
    }
  }

  const shown = draft ?? formatNumber(value);

  const handleChange = (raw: string) => {
    if (raw === "") {
      // Transient empty while typing: keep the draft, touch nothing.
      setDraft("");
      return;
    }
    const parsed = Number(raw);
    const outOfRange = parsed < min || parsed > max;
    if (!Number.isFinite(parsed) || (outOfRange && outOfRangePolicy === "reject")) {
      const message = Number.isFinite(parsed)
        ? `「${label}」请求值 ${raw} 超出工程安全范围 ${formatNumber(min)}–${formatNumber(max)}，未写入（当前保留 ${formatNumber(value)}；范围由房间边界与内容 Schema 推导，非导演批准范围）`
        : `「${label}」请输入数字（允许范围 ${formatNumber(min)} 至 ${formatNumber(max)}）`;
      setDraft(raw);
      setFieldWarning(message);
      onWarning(message);
      return;
    }
    setDraft(null);
    setFieldWarning("");
    onCommit(parsed);
  };

  return (
    <label className="number-field">
      <span className="number-field-label">{label}</span>
      <input
        type="number"
        data-testid={testId}
        aria-label={`${label}（单位 ${unit}，允许范围 ${formatNumber(min)} 至 ${formatNumber(max)}${rangeNote ? `，${rangeNote}` : ""}）`}
        aria-invalid={fieldWarning !== ""}
        value={shown}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          handleChange(event.target.value);
        }}
      />
      <span className="number-field-range" data-testid={`${testId}-range`}>
        {unit} · {formatNumber(min)}–{formatNumber(max)}
        {rangeNote ? `（${rangeNote}）` : ""}
      </span>
      {fieldWarning !== "" ? (
        <span className="number-field-warning" data-testid={`${testId}-warning`} role="alert">
          {fieldWarning}
        </span>
      ) : null}
    </label>
  );
}

/**
 * NumberField bound to the canonical-state lifecycle epoch (R2): template
 * switches and resets invalidate every held draft, while ordinary edits do
 * not — the field-level invalidation itself stays inside NumberField.
 */
function RefinementField(props: Omit<ComponentProps<typeof NumberField>, "lifecycleEpoch">) {
  const lifecycleEpoch = useStore(appShotStore, (state) => state.stateEpoch);
  return <NumberField {...props} lifecycleEpoch={lifecycleEpoch} />;
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

  /**
   * Safe-range feedback (Phase 3 Day 9): the store commands clamp silently,
   * so after committing, the APPLIED value is read back and compared with the
   * requested one; any difference is surfaced as a visible warning instead of
   * staying invisible. Refusals (command errors) keep their reason.
   */
  const commitWithReadBack = (
    label: string,
    commit: () => void,
    readBack: () => number,
    requested: number,
  ) => {
    try {
      commit();
      const applied = readBack();
      if (applied !== requested) {
        onWarning(
          `「${label}」请求值 ${requested} 超出工程安全范围，已收拢为 ${applied}（范围由房间边界与内容 Schema 推导，非导演批准范围）`,
        );
      } else {
        onWarning("");
      }
    } catch (error) {
      onWarning(error instanceof Error ? error.message : String(error));
    }
  };

  const commitVec3 = (
    label: string,
    apply: (next: Vec3) => void,
    readBack: () => number,
    current: Vec3,
    index: number,
    parsed: number,
  ) => {
    const next = [...current] as Vec3;
    next[index] = parsed;
    commitWithReadBack(label, () => apply(next), readBack, parsed);
  };

  const characterA = characterOf("character_a");
  const characterB = characterOf("character_b");

  return (
    <details className="transform-refinement" data-testid="advanced-refinement">
      <summary>高级 3D 调整（可选，默认收起）</summary>
      <div className="transform-refinement-body">
        <p className="control-hint">
          受临时工程约束（provisional engineering constraints）限制的数值编辑，范围由房间边界与内容
          Schema
          推导，非导演批准范围。超出允许范围的输入不会被写入（保持上一次合法值）并持续提示，直到改回范围内；命令层仍保留收拢（clamp）作为兜底。
        </p>
        <fieldset className="refinement-group" data-testid="refinement-camera">
          <legend>相机</legend>
          <div className="number-field-row">
            <RefinementField
              label="位置 x"
              unit="m"
              value={camera.position[0]}
              min={CAMERA_POSITION_X_RANGE_M.min}
              max={CAMERA_POSITION_X_RANGE_M.max}
              step={0.05}
              testId="input-camera-position-x"
              onWarning={onWarning}
              onCommit={(next) =>
                commitVec3(
                  "相机位置 x",
                  setCameraPosition,
                  () => appShotStore.getState().shotState!.camera.position[0],
                  camera.position,
                  0,
                  next,
                )
              }
            />
            <RefinementField
              label="位置 y"
              unit="m"
              value={camera.position[1]}
              min={CAMERA_POSITION_Y_RANGE_M.min}
              max={CAMERA_POSITION_Y_RANGE_M.max}
              step={0.05}
              testId="input-camera-position-y"
              onWarning={onWarning}
              onCommit={(next) =>
                commitVec3(
                  "相机位置 y",
                  setCameraPosition,
                  () => appShotStore.getState().shotState!.camera.position[1],
                  camera.position,
                  1,
                  next,
                )
              }
            />
            <RefinementField
              label="位置 z"
              unit="m"
              value={camera.position[2]}
              min={CAMERA_POSITION_Z_RANGE_M.min}
              max={CAMERA_POSITION_Z_RANGE_M.max}
              step={0.05}
              testId="input-camera-position-z"
              onWarning={onWarning}
              onCommit={(next) =>
                commitVec3(
                  "相机位置 z",
                  setCameraPosition,
                  () => appShotStore.getState().shotState!.camera.position[2],
                  camera.position,
                  2,
                  next,
                )
              }
            />
          </div>
          <div className="number-field-row">
            <RefinementField
              label="目标 x"
              unit="m"
              value={camera.target[0]}
              min={CAMERA_POSITION_X_RANGE_M.min}
              max={CAMERA_POSITION_X_RANGE_M.max}
              step={0.05}
              testId="input-camera-target-x"
              onWarning={onWarning}
              onCommit={(next) =>
                commitVec3(
                  "相机目标 x",
                  setCameraTarget,
                  () => appShotStore.getState().shotState!.camera.target[0],
                  camera.target,
                  0,
                  next,
                )
              }
            />
            <RefinementField
              label="目标 y"
              unit="m"
              value={camera.target[1]}
              min={CAMERA_POSITION_Y_RANGE_M.min}
              max={CAMERA_POSITION_Y_RANGE_M.max}
              step={0.05}
              testId="input-camera-target-y"
              onWarning={onWarning}
              onCommit={(next) =>
                commitVec3(
                  "相机目标 y",
                  setCameraTarget,
                  () => appShotStore.getState().shotState!.camera.target[1],
                  camera.target,
                  1,
                  next,
                )
              }
            />
            <RefinementField
              label="目标 z"
              unit="m"
              value={camera.target[2]}
              min={CAMERA_POSITION_Z_RANGE_M.min}
              max={CAMERA_POSITION_Z_RANGE_M.max}
              step={0.05}
              testId="input-camera-target-z"
              onWarning={onWarning}
              onCommit={(next) =>
                commitVec3(
                  "相机目标 z",
                  setCameraTarget,
                  () => appShotStore.getState().shotState!.camera.target[2],
                  camera.target,
                  2,
                  next,
                )
              }
            />
          </div>
          <RefinementField
            label="焦距"
            unit="mm"
            rangeNote="Schema 范围"
            value={camera.focalLengthMm}
            min={12}
            max={200}
            step={1}
            testId="input-camera-focal-length"
            onWarning={onWarning}
            onCommit={(next) =>
              commitWithReadBack(
                "焦距",
                () => setCameraFocalLength(next),
                () => appShotStore.getState().shotState!.camera.focalLengthMm,
                next,
              )
            }
          />
        </fieldset>
        {(["character_a", "character_b"] as const).map((id) => {
          const character = id === "character_a" ? characterA : characterB;
          const label = id === "character_a" ? "角色 A" : "角色 B";
          return (
            <fieldset className="refinement-group" key={id} data-testid={`refinement-${id}`}>
              <legend>{label}</legend>
              <div className="number-field-row">
                <RefinementField
                  label="位置 x"
                  unit="m"
                  value={character.position[0]}
                  min={CHARACTER_POSITION_X_RANGE_M.min}
                  max={CHARACTER_POSITION_X_RANGE_M.max}
                  step={0.05}
                  testId={`input-${id}-position-x`}
                  onWarning={onWarning}
                  onCommit={(next) =>
                    commitVec3(
                      `${label}位置 x`,
                      setCharacterPosition.bind(null, id),
                      () =>
                        appShotStore.getState().shotState!.characters.find((c) => c.id === id)!
                          .position[0],
                      character.position,
                      0,
                      next,
                    )
                  }
                />
                <RefinementField
                  label="位置 z"
                  unit="m"
                  value={character.position[2]}
                  min={CHARACTER_POSITION_Z_RANGE_M.min}
                  max={CHARACTER_POSITION_Z_RANGE_M.max}
                  step={0.05}
                  testId={`input-${id}-position-z`}
                  onWarning={onWarning}
                  onCommit={(next) =>
                    commitVec3(
                      `${label}位置 z`,
                      setCharacterPosition.bind(null, id),
                      () =>
                        appShotStore.getState().shotState!.characters.find((c) => c.id === id)!
                          .position[2],
                      character.position,
                      2,
                      next,
                    )
                  }
                />
                <RefinementField
                  label="朝向角"
                  unit="°"
                  rangeNote="自动归一"
                  value={character.rotationYDeg}
                  min={-180}
                  max={180}
                  step={5}
                  testId={`input-${id}-yaw`}
                  onWarning={onWarning}
                  outOfRangePolicy="commit"
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

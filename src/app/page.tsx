"use client";

/**
 * Director studio home (Prompt 4 / Phase 1 Day 4; movement preview and raw
 * export from Prompt 5 / Phase 1 Day 5).
 *
 * Template gallery -> canonical ShotState -> simple semantic controls +
 * optional constrained 3D refinement -> live director/camera preview, with
 * browser-local session persistence. The movement preview feeds an ephemeral
 * interpolated camera pose into the stage (temporary UI state only), and the
 * raw export freezes one validated ShotState snapshot into a five-file ZIP.
 *
 * Development boundary: the gallery lists ONLY templates loaded through the
 * explicit development opt-in (engineering_ready). The production loader
 * still returns zero templates for the current content; no template is
 * director-approved and nothing here changes that.
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand/react";

import { loadDevelopmentTemplates, loadProductionTemplates } from "@/content/loader";
import { COMPILED_SHOT_TEMPLATES } from "@/content/compiled-content";
import { verticalFovDeg } from "@/domain/camera-math";
import { interpolateCameraPose } from "@/domain/movement";
import { TransformRefinement } from "@/features/director-stage/TransformRefinement";
import { RawExport } from "@/features/export-package/RawExport";
import { DirectorStage, type DirectorStageView } from "@/features/rendering/DirectorStage";
import {
  MovementPreview,
  type MovementPreviewUiState,
} from "@/features/movement-preview/MovementPreview";
import { SimpleControls } from "@/features/simple-controls/SimpleControls";
import { TemplateGallery } from "@/features/shot-library/TemplateGallery";
import { appShotStore } from "@/state/app-shot-store";
import {
  attachSessionPersistence,
  safeLocalStorage,
  type PersistenceStatus,
} from "@/state/session-persistence";

const DEVELOPMENT_INCLUDE_STATUSES = ["engineering_ready"] as const;

/** Non-canonical footer copy keyed by the real persistence outcome. */
const PERSISTENCE_STATUS_COPY: Record<PersistenceStatus, string> = {
  pending: "正在确认本地保存状态…",
  saved: "已保存到此浏览器（localStorage）",
  unavailable: "本地保存不可用；编辑仅保留在当前页面",
  write_failed: "本地保存失败；编辑仍保留在当前页面",
};

function formatVec3(values: readonly number[]): string {
  return `[${values.map((value) => value.toFixed(2)).join(", ")}]`;
}

export default function Home() {
  // The gallery's explicit development opt-in, identical to the test loaders.
  const galleryTemplates = useMemo(
    () =>
      loadDevelopmentTemplates(COMPILED_SHOT_TEMPLATES, {
        includeStatuses: DEVELOPMENT_INCLUDE_STATUSES,
      }),
    [],
  );
  // Production boundary evidence shown in the header: still zero today.
  const productionTemplateCount = useMemo(
    () => loadProductionTemplates(COMPILED_SHOT_TEMPLATES).length,
    [],
  );

  const shotState = useStore(appShotStore, (state) => state.shotState);
  const hydrated = useStore(appShotStore, (state) => state.hydrated);
  const [view, setView] = useState<DirectorStageView>("director");
  const [warning, setWarning] = useState("");
  // UI/infrastructure state only — never camera, character, scene or any
  // ShotState truth, so React local state is the right home for it.
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>("pending");
  // Movement preview progress is equally ephemeral UI state: the interpolated
  // pose below is derived from ShotState.movement on every render and passed
  // to the stage as a rendering override — never back into the store.
  const [movementPreview, setMovementPreview] = useState<MovementPreviewUiState>({
    enabled: false,
    progress: 0,
  });
  const previewPose = useMemo(
    () =>
      shotState !== null && movementPreview.enabled
        ? interpolateCameraPose(shotState.movement, movementPreview.progress)
        : undefined,
    [shotState, movementPreview],
  );

  // Session persistence: hydrate once on mount (never during SSR), then save
  // every new canonical ShotState. `hydrated` still only means "the restore
  // attempt has finished"; every footer status — including `unavailable` for
  // an unusable storage — arrives through the adapter's real-outcome callback.
  useEffect(
    () =>
      attachSessionPersistence(appShotStore, {
        storage: safeLocalStorage(),
        templates: COMPILED_SHOT_TEMPLATES,
        onStatusChange: setPersistenceStatus,
      }),
    [],
  );

  const fovDeg =
    shotState === null
      ? null
      : verticalFovDeg(shotState.camera.focalLengthMm, shotState.aspectRatio);

  return (
    <main className="studio-page" data-testid="studio-root">
      <header className="studio-header">
        <h1>Storyboard Director MVP — 导演工作台</h1>
        <div className="studio-badges">
          <span className="badge-development-fixture">DEVELOPMENT WORKSPACE</span>
          <span className="badge-review-status">engineering_ready · not director approved</span>
          <span className="badge-production-count" data-testid="production-template-count">
            production gallery: {productionTemplateCount}
          </span>
        </div>
      </header>

      <TemplateGallery
        templates={galleryTemplates}
        selectedTemplateId={shotState?.template.id ?? null}
        onSelect={(templateId) => {
          try {
            appShotStore.getState().selectTemplate(templateId);
            setWarning("");
          } catch (error) {
            setWarning(error instanceof Error ? error.message : String(error));
          }
        }}
      />

      {shotState === null ? (
        <p className="studio-empty" data-testid="studio-empty">
          {hydrated
            ? "尚未选择模板。选择一个开发模板以创建 ShotState 并开始调整。"
            : "正在恢复本地会话…"}
        </p>
      ) : (
        <section className="studio-workspace" data-testid="studio-workspace">
          <div className="studio-stage-pane">
            <div className="director-stage-toolbar">
              <div className="director-stage-toggle-group" role="group" aria-label="Stage view">
                <button
                  type="button"
                  className="director-stage-toggle"
                  data-testid="view-toggle-director"
                  aria-pressed={view === "director"}
                  onClick={() => setView("director")}
                >
                  Director view
                </button>
                <button
                  type="button"
                  className="director-stage-toggle"
                  data-testid="view-toggle-camera"
                  aria-pressed={view === "camera"}
                  onClick={() => setView("camera")}
                >
                  Camera view
                </button>
              </div>
              <p className="director-stage-view-help">
                {view === "director"
                  ? "Director view — 检查机位、假人与视锥（frustum）。"
                  : "Camera view — 由 canonical ShotState 相机渲染。"}
              </p>
            </div>
            <div className="studio-stage-frame-wrap">
              <DirectorStage shotState={shotState} view={view} cameraPoseOverride={previewPose} />
            </div>
            <footer className="studio-stage-footer">
              {/* Masked in visual baselines: the ShotState ID is unique per load. */}
              <span data-testid="footer-shot-state">shot-state: {shotState.id}</span>
              <span data-testid="footer-template">
                {shotState.template.id} v{shotState.template.version} ·{" "}
                {shotState.template.reviewStatus}
              </span>
              <span data-testid="footer-camera">
                camera {formatVec3(shotState.camera.position)} →{" "}
                {formatVec3(shotState.camera.target)} · {shotState.camera.focalLengthMm}mm (vFOV{" "}
                {fovDeg?.toFixed(2)}°) · {shotState.aspectRatio}
              </span>
              <span data-testid="footer-characters">
                A {formatVec3(shotState.characters[0].position)} /{" "}
                {shotState.characters[0].rotationYDeg}° · B{" "}
                {formatVec3(shotState.characters[1].position)} /{" "}
                {shotState.characters[1].rotationYDeg}°
              </span>
              <span data-testid="footer-persisted">
                {PERSISTENCE_STATUS_COPY[persistenceStatus]}
              </span>
            </footer>
          </div>
          <aside className="studio-controls-pane">
            <SimpleControls onWarning={setWarning} />
            <MovementPreview
              shotState={shotState}
              preview={movementPreview}
              onPreviewChange={setMovementPreview}
            />
            <TransformRefinement onWarning={setWarning} />
            <RawExport />
            <p className="command-warning" data-testid="command-warning" hidden={warning === ""}>
              {warning}
            </p>
          </aside>
        </section>
      )}
    </main>
  );
}

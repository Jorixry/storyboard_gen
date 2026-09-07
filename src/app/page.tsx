"use client";

/**
 * Director studio home (Prompt 4 / Phase 1 Day 4).
 *
 * Template gallery -> canonical ShotState -> simple semantic controls +
 * optional constrained 3D refinement -> live director/camera preview, with
 * browser-local session persistence.
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
import { TransformRefinement } from "@/features/director-stage/TransformRefinement";
import { DirectorStage, type DirectorStageView } from "@/features/rendering/DirectorStage";
import { SimpleControls } from "@/features/simple-controls/SimpleControls";
import { TemplateGallery } from "@/features/shot-library/TemplateGallery";
import { appShotStore } from "@/state/app-shot-store";
import { attachSessionPersistence, safeLocalStorage } from "@/state/session-persistence";

const DEVELOPMENT_INCLUDE_STATUSES = ["engineering_ready"] as const;

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

  // Session persistence: hydrate once on mount (never during SSR), then save
  // every new canonical ShotState. Falls back silently to a fresh session.
  useEffect(() => {
    const storage = safeLocalStorage();
    if (storage === null) {
      appShotStore.setState({ hydrated: true });
      return;
    }
    return attachSessionPersistence(appShotStore, {
      storage,
      templates: COMPILED_SHOT_TEMPLATES,
    });
  }, []);

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
              <DirectorStage shotState={shotState} view={view} />
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
                {hydrated
                  ? "session persisted locally (localStorage)"
                  : "session hydration pending"}
              </span>
            </footer>
          </div>
          <aside className="studio-controls-pane">
            <SimpleControls onWarning={setWarning} />
            <TransformRefinement onWarning={setWarning} />
            <p className="command-warning" data-testid="command-warning" hidden={warning === ""}>
              {warning}
            </p>
          </aside>
        </section>
      )}
    </main>
  );
}

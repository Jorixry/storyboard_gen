"use client";

/**
 * Static director stage page (Prompt 3 / Phase 1 Day 3).
 *
 * Loads ONE clearly labeled development fixture (an `engineering_ready`
 * template) through the explicit development loader opt-in — never the
 * production loader — and projects the resulting canonical ShotState into the
 * 3D stage. This page is a development surface, not the Prompt 4 gallery:
 * there is no template selection, no editable controls, no persistence.
 */
import { useMemo, useState } from "react";

import { COMPILED_SHOT_TEMPLATES } from "@/content/compiled-content";
import { verticalFovDeg } from "@/domain/camera-math";
import { DirectorStage, type DirectorStageView } from "@/features/rendering/DirectorStage";
import { resolveDevelopmentFixture } from "@/features/rendering/development-fixture";

const DEVELOPMENT_FIXTURE_TEMPLATE_ID = "dialogue_ots_a_to_b";
const DEVELOPMENT_FIXTURE_INCLUDE_STATUSES = ["engineering_ready"] as const;

const VIEW_HELP: Record<DirectorStageView, string> = {
  director:
    "Director view — independent inspection camera; the shot camera body and its accurate frustum are visible.",
  camera:
    "Camera view — rendered through the canonical ShotState camera (position, target and focal length from the fixture).",
};

function formatVec3(values: readonly number[]): string {
  return `[${values.map((value) => value.toFixed(2)).join(", ")}]`;
}

export default function DirectorStagePage() {
  const fixture = useMemo(
    () =>
      resolveDevelopmentFixture(COMPILED_SHOT_TEMPLATES, {
        templateId: DEVELOPMENT_FIXTURE_TEMPLATE_ID,
        includeStatuses: DEVELOPMENT_FIXTURE_INCLUDE_STATUSES,
      }),
    [],
  );
  const [view, setView] = useState<DirectorStageView>("director");
  const { shotState, template } = fixture;
  const fovDeg = verticalFovDeg(shotState.camera.focalLengthMm, shotState.aspectRatio);

  return (
    <main className="director-stage-page">
      <header className="director-stage-header">
        <h1>Director Stage</h1>
        <div className="director-stage-badges">
          <span className="badge-development-fixture">DEVELOPMENT FIXTURE</span>
          <span className="badge-review-status">
            {template.reviewStatus} · not director approved
          </span>
          <span className="badge-template-id">
            {template.id} v{template.version}
          </span>
        </div>
      </header>
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
        <p className="director-stage-view-help">{VIEW_HELP[view]}</p>
      </div>
      <DirectorStage shotState={shotState} view={view} />
      <footer className="director-stage-footer">
        {/* Masked in visual baselines: the ShotState ID is unique per load. */}
        <span data-testid="footer-shot-state">shot-state: {shotState.id}</span>
        <span>
          camera {formatVec3(shotState.camera.position)} → {formatVec3(shotState.camera.target)} ·{" "}
          {shotState.camera.focalLengthMm}mm (vFOV {fovDeg.toFixed(2)}°) · {shotState.aspectRatio}
        </span>
        <span>
          characters: A {formatVec3(shotState.characters[0].position)} /{" "}
          {shotState.characters[0].rotationYDeg}° · B {formatVec3(shotState.characters[1].position)}{" "}
          / {shotState.characters[1].rotationYDeg}°
        </span>
        <span>
          movement: {shotState.movement.type} (start/end preserved; preview arrives Phase 1 Day 5)
        </span>
      </footer>
    </main>
  );
}

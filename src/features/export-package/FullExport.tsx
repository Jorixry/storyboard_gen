"use client";

/**
 * Full input-package export UI (Prompt 8 / Phase 2 §2.3 + Phase 3 Day 9).
 *
 * The MVP "definition of done" download: one click freezes the canonical
 * ShotState, captures the SAME three readiness-gated rasters the raw export
 * uses, compiles BOTH prompts (Prompt 6 generic + the Seedance target-model
 * adapter) from that same frozen state, attaches the current enhanced first
 * frame when one exists (full-state fingerprint decides staleness), and
 * assembles the 8-or-9-file ZIP through buildFullExportPackage — whose
 * executable same-source verification refuses any artifact that does not
 * point at this exact state/template versions, and whose template-diff.txt
 * summarizes the field-level deviations from the template defaults.
 *
 * Boundary rules mirror the raw export: everything lives in local state
 * during one export; the canonical store is never touched; prompts are
 * derived artifacts only. Raw export remains independently usable.
 */
import { useState } from "react";
import { useStore } from "zustand/react";

import { base64ToBytes } from "@/adapters/image-generation/binary";
import {
  GENERIC_VIDEO_ADAPTER_ID,
  GenericVideoPromptAdapter,
} from "@/adapters/video-prompts/generic";
import {
  SEEDANCE_VIDEO_ADAPTER_ID,
  SeedanceVideoPromptAdapter,
} from "@/adapters/video-prompts/seedance";
import { COMPILED_ADAPTER_CONFIGS, COMPILED_SHOT_TEMPLATES } from "@/content/compiled-content";
import { shotStateFingerprint, shotStateSchema, type ShotState } from "@/domain/shot-state";
import { compileVideoPrompt } from "@/features/prompt-compiler/compile";
import { appShotStore } from "@/state/app-shot-store";
import { enhancedFrameStore } from "@/state/enhanced-frame-store";

import { PoseCaptureStage, type CapturedPoseImages } from "./capture-stage";
import { buildFullExportPackage, type FullExportEnhancedFrame } from "./full-export-package";

const OBJECT_URL_RELEASE_DELAY_MS = 30_000;

type ExportPhase = "idle" | "capturing" | "packaging" | "done" | "error";

const PHASE_COPY: Record<Exclude<ExportPhase, "idle" | "error">, string> = {
  capturing: "正在按冻结的 ShotState 快照渲染 current / start / end 相机视图…",
  packaging: "正在编译双 prompt 并组装完整输入包…",
  done: "",
};

function promptAdapterConfigs(): {
  generic: GenericVideoPromptAdapter;
  target: SeedanceVideoPromptAdapter;
} {
  const genericConfig = COMPILED_ADAPTER_CONFIGS.find((c) => c.id === GENERIC_VIDEO_ADAPTER_ID);
  const targetConfig = COMPILED_ADAPTER_CONFIGS.find((c) => c.id === SEEDANCE_VIDEO_ADAPTER_ID);
  if (genericConfig === undefined || targetConfig === undefined) {
    throw new Error(
      `adapter configs missing from compiled content (need ${GENERIC_VIDEO_ADAPTER_ID} + ${SEEDANCE_VIDEO_ADAPTER_ID})`,
    );
  }
  return {
    generic: new GenericVideoPromptAdapter(genericConfig),
    target: new SeedanceVideoPromptAdapter(targetConfig),
  };
}

export function FullExport() {
  const shotState = useStore(appShotStore, (state) => state.shotState);
  const enhancedResult = useStore(enhancedFrameStore, (state) => state.result);
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [frozen, setFrozen] = useState<ShotState | null>(null);
  const [status, setStatus] = useState("");
  /** Compiler warnings of the last successful package (R4): shown next to it. */
  const [lastWarnings, setLastWarnings] = useState<{
    generic: string[];
    target: string[];
  } | null>(null);

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
    setLastWarnings(null);
    setPhase("capturing");
    setStatus(PHASE_COPY.capturing);
  };

  function templateFor(state: ShotState) {
    const template = COMPILED_SHOT_TEMPLATES.find(
      (t) => t.id === state.template.id && t.version === state.template.version,
    );
    if (template === undefined) {
      throw new Error(
        `diff 基线模板缺失：${state.template.id}@v${state.template.version} 不在当前内容中，导出被拒绝`,
      );
    }
    return template;
  }

  /** Enhanced-frame inclusion: only a fingerprint-current result ships. */
  const resolveEnhanced = (
    snapshotState: ShotState,
  ): FullExportEnhancedFrame | { reason: "absent" | "stale" } => {
    if (enhancedResult === null) {
      return { reason: "absent" };
    }
    if (shotStateFingerprint(enhancedResult.sourceState) !== shotStateFingerprint(snapshotState)) {
      return { reason: "stale" };
    }
    return {
      bytes: base64ToBytes(enhancedResult.imageBase64),
      mimeType: enhancedResult.imageMimeType,
      adapterId: enhancedResult.adapterId,
      adapterVersion: enhancedResult.adapterVersion,
      provider: enhancedResult.provider,
      sourceFingerprint: shotStateFingerprint(enhancedResult.sourceState),
      metadata: enhancedResult.metadata,
    };
  };

  const handleCaptured = async (snapshotState: ShotState, images: CapturedPoseImages) => {
    setPhase("packaging");
    setStatus(PHASE_COPY.packaging);
    try {
      const adapters = promptAdapterConfigs();
      const [genericPrompt, targetPrompt] = await Promise.all([
        compileVideoPrompt(snapshotState, adapters.generic),
        compileVideoPrompt(snapshotState, adapters.target),
      ]);
      const pkg = await buildFullExportPackage({
        shotState: snapshotState,
        template: templateFor(snapshotState),
        images,
        prompts: { generic: genericPrompt, target: targetPrompt },
        enhancedFrame: resolveEnhanced(snapshotState),
        generatedAt: new Date(),
      });
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
      const enhancedNote = pkg.manifest.enhancedFrame.included
        ? `含增强首帧 ${pkg.manifest.enhancedFrame.fileName}`
        : `未含增强首帧（${pkg.manifest.enhancedFrame.reason}）`;
      setStatus(
        `已生成 ${pkg.fileName}（${pkg.manifest.files.length} 个文件 · ${enhancedNote} · ${pkg.zip.byteLength} bytes）`,
      );
      setLastWarnings({
        generic: pkg.manifest.prompts.generic.warnings,
        target: pkg.manifest.prompts.target.warnings,
      });
    } catch (error) {
      setPhase("error");
      setStatus(`完整导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setFrozen(null);
    }
  };

  const handleCaptureError = (message: string) => {
    setPhase("error");
    setStatus(`完整导出失败：${message}`);
    setFrozen(null);
  };

  return (
    <section className="full-export" data-testid="full-export" aria-label="完整导出">
      <h3>导出完整输入包（full export）</h3>
      <p className="control-hint">
        完整 ZIP 包含：shot-state.json、composition-raw.png、movement-start.png、
        movement-end.png、prompt-generic.txt（模型无关）、prompt-seedance.txt（目标模型工程推导稿，
        不声称官方支持）、template-diff.txt（相对模板默认值的逐字段改动摘要），以及当前有效的增强首帧
        （若无或已过期则跳过并在 manifest 记录原因）；manifest 校验所有工件同源。raw ZIP
        仍可单独导出。
      </p>
      <div className="control-group">
        <button
          type="button"
          data-testid="export-full-zip"
          disabled={shotState === null || busy}
          onClick={startExport}
        >
          {busy ? "导出中…" : "导出完整输入包"}
        </button>
      </div>
      <p className="control-hint" data-testid="full-export-status" hidden={status === ""}>
        {status}
      </p>
      {lastWarnings !== null &&
        (lastWarnings.generic.length > 0 || lastWarnings.target.length > 0) && (
          <div className="command-warning" data-testid="full-export-prompt-warnings" role="alert">
            <p>
              编译警告（已随 manifest 导出，共{" "}
              {lastWarnings.generic.length + lastWarnings.target.length} 条；警告不阻止导出，raw
              导出亦不受影响）：
            </p>
            <ul>
              {lastWarnings.generic.map((warning) => (
                <li key={`generic-${warning}`} data-testid="full-export-prompt-warning-item">
                  generic（generic_video）：{warning}
                </li>
              ))}
              {lastWarnings.target.map((warning) => (
                <li key={`target-${warning}`} data-testid="full-export-prompt-warning-item">
                  target（seedance_video）：{warning}
                </li>
              ))}
            </ul>
          </div>
        )}
      {phase === "capturing" && frozen !== null && (
        <PoseCaptureStage
          frozen={frozen}
          onComplete={(images) => void handleCaptured(frozen, images)}
          onError={handleCaptureError}
        />
      )}
    </section>
  );
}

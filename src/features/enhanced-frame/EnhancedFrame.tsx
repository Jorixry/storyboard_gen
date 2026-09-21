"use client";

/**
 * Optional enhanced first frame (Prompt 7B1 / Phase 2 Day 8 fallback: finish
 * the mock path and failure handling).
 *
 * Explicit-action contract: nothing is generated until the user clicks the
 * button inside this deliberately collapsed <details>. The click freezes the
 * canonical ShotState once, captures the CURRENT camera pose as a PNG through
 * the same readiness-gated hidden stage the raw export uses, compiles the
 * Prompt 6 deterministic generic prompt from that same frozen state, and sends
 * both to the server-side /api/enhanced-frame adapter path (D027 single-active;
 * mock by default until Prompt 7B2 + credentials).
 *
 * Failure tolerance: any failure (capture, validation, network, provider) only
 * sets a local, retryable error message. The raw export shares no state with
 * this component and is never blocked.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand/react";

import {
  GENERIC_VIDEO_ADAPTER_ID,
  GenericVideoPromptAdapter,
} from "@/adapters/video-prompts/generic";
import { COMPILED_ADAPTER_CONFIGS } from "@/content/compiled-content";
import { exportImageDimensions } from "@/domain/artifacts";
import { shotStateSchema, type ShotState } from "@/domain/shot-state";
import { compileVideoPrompt } from "@/features/prompt-compiler/compile";
import { DirectorStage, type StageSnapshot } from "@/features/rendering/DirectorStage";
import { appShotStore } from "@/state/app-shot-store";

import { poseMatchesSnapshot } from "@/features/export-package/capture-readiness";

const CAPTURE_TIMEOUT_MS = 30_000;

type Phase = "idle" | "capturing" | "requesting" | "done" | "error";

const PHASE_COPY: Record<Exclude<Phase, "idle" | "error">, string> = {
  capturing: "正在按冻结的 ShotState 快照渲染当前相机视图…",
  requesting: "正在通过 /api/enhanced-frame 生成（当前为确定性 mock）…",
  done: "",
};

interface EnhancedFrameResultView {
  dataUrl: string;
  adapterId: string;
  adapterVersion: string;
  provider: string;
  metadata: Record<string, string>;
}

/** Hidden single-pose capture stage: the raw-export pattern, CURRENT pose only. */
function CompositionCaptureStage({
  frozen,
  onComplete,
  onError,
}: {
  frozen: ShotState;
  onComplete: (blob: Blob) => void;
  onError: (message: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<StageSnapshot | null>(null);
  const captured = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dimensions = exportImageDimensions(frozen.aspectRatio);
  const pose = frozen.camera;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onError("camera-view capture for the current pose did not become ready in time");
    }, CAPTURE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [onError]);

  useEffect(() => {
    if (captured.current) {
      return;
    }
    if (snapshot === null || !poseMatchesSnapshot(pose, frozen.aspectRatio, dimensions, snapshot)) {
      return;
    }
    captured.current = true;
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
      onComplete(blob);
    }, "image/png");
  }, [snapshot, pose, frozen, dimensions, onComplete, onError]);

  return (
    <div
      ref={containerRef}
      className="enhanced-frame-capture-stage"
      data-testid="enhanced-frame-capture-stage"
      style={{ width: dimensions.width, height: dimensions.height }}
      aria-hidden="true"
    >
      <DirectorStage shotState={frozen} view="camera" onSnapshot={setSnapshot} />
    </div>
  );
}

export function EnhancedFrame() {
  const shotState = useStore(appShotStore, (state) => state.shotState);
  const [phase, setPhase] = useState<Phase>("idle");
  const [frozen, setFrozen] = useState<ShotState | null>(null);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<EnhancedFrameResultView | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const busy = phase === "capturing" || phase === "requesting";

  const start = () => {
    if (shotState === null || busy) {
      return;
    }
    const parsed = shotStateSchema.safeParse(shotState);
    if (!parsed.success) {
      setPhase("error");
      setErrorMessage(`ShotState 校验失败，生成被拒绝：${parsed.error.message}`);
      return;
    }
    setResult(null);
    setErrorMessage("");
    setFrozen(parsed.data);
    setPhase("capturing");
    setStatus(PHASE_COPY.capturing);
  };

  const requestEnhancedFrame = async (snapshotState: ShotState, composition: Blob) => {
    setPhase("requesting");
    setStatus(PHASE_COPY.requesting);
    try {
      const config = COMPILED_ADAPTER_CONFIGS.find((c) => c.id === GENERIC_VIDEO_ADAPTER_ID);
      if (config === undefined) {
        throw new Error('adapter config "generic_video" missing from compiled content');
      }
      const compiled = await compileVideoPrompt(
        snapshotState,
        new GenericVideoPromptAdapter(config),
      );
      const formData = new FormData();
      formData.append("compositionImage", composition, "composition-raw.png");
      formData.append("prompt", compiled.prompt);
      const response = await fetch("/api/enhanced-frame", { method: "POST", body: formData });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof body === "object" && body !== null && "message" in body
            ? String((body as { message: unknown }).message)
            : `HTTP ${response.status}`;
        throw new Error(message);
      }
      const payload = body as {
        imageBase64: string;
        imageMimeType: string;
        adapterId: string;
        adapterVersion: string;
        provider: string;
        metadata: Record<string, string>;
      };
      setPhase("done");
      setStatus("");
      setResult({
        dataUrl: `data:${payload.imageMimeType};base64,${payload.imageBase64}`,
        adapterId: payload.adapterId,
        adapterVersion: payload.adapterVersion,
        provider: payload.provider,
        metadata: payload.metadata,
      });
    } catch (error) {
      setPhase("error");
      setStatus("");
      setErrorMessage(
        `增强首帧生成失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setFrozen(null);
    }
  };

  const handleCaptureError = (message: string) => {
    setPhase("error");
    setStatus("");
    setErrorMessage(`增强首帧生成失败：${message}`);
    setFrozen(null);
  };

  return (
    <details className="enhanced-frame" data-testid="enhanced-frame">
      <summary>增强首帧（可选，默认收起）</summary>
      <div className="enhanced-frame-body">
        <p className="control-hint">
          显式动作：点击后才会生成。服务端默认走确定性 mock 适配器（IMAGE_PROVIDER
          未配置时）；管理员配置 IMAGE_PROVIDER=seedream / wanxiang 并提供对应凭据后走真实生成（D027
          单活）。生成失败仅提示可重试，不影响 raw export。
        </p>
        <div className="control-group">
          <button
            type="button"
            data-testid="generate-enhanced-frame"
            disabled={shotState === null || busy}
            onClick={start}
          >
            {phase === "error" ? "重试生成增强首帧" : busy ? "生成中…" : "生成增强首帧"}
          </button>
        </div>
        <p className="control-hint" data-testid="enhanced-frame-status" hidden={status === ""}>
          {status}
        </p>
        {result !== null && (
          <div className="enhanced-frame-result" data-testid="enhanced-frame-result">
            {/* Runtime data-URL preview of a just-generated image (mock or
                provider, per the server's active adapter); next/image
                optimization does not apply to data URLs. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result.dataUrl} alt="增强首帧" data-testid="enhanced-frame-image" />
            <p className="control-hint" data-testid="enhanced-frame-provider">
              adapter {result.adapterId}@{result.adapterVersion} · provider=
              {result.provider} · metadata {JSON.stringify(result.metadata)}
            </p>
          </div>
        )}
        <p
          className="command-warning"
          data-testid="enhanced-frame-error"
          hidden={phase !== "error"}
        >
          {errorMessage}（可重试；raw 导出不受影响）
        </p>
        {phase === "capturing" && frozen !== null && (
          <CompositionCaptureStage
            frozen={frozen}
            onComplete={(blob) => void requestEnhancedFrame(frozen, blob)}
            onError={handleCaptureError}
          />
        )}
      </div>
    </details>
  );
}

/**
 * Shared enhanced-first-frame result store (Prompt 8 / Phase 2 §2.3).
 *
 * The generated frame is a DERIVED artifact, never canonical state: it lives
 * here — outside appShotStore — so the export package can read the current
 * result while the canonical ShotState remains the only product truth. The
 * store keeps the COMPLETE frozen ShotState the frame was generated from
 * (continuing the 9b320fa provenance rule): consumers decide staleness by
 * full-state fingerprint, never by shot id alone.
 *
 * UI/infrastructure state only; nothing here is persisted to localStorage.
 */
import { create } from "zustand";

import type { ShotState } from "@/domain/shot-state";

export interface EnhancedFrameArtifact {
  /** Exact generated image bytes (base64-decoded from the route response). */
  imageBase64: string;
  imageMimeType: string;
  adapterId: string;
  adapterVersion: string;
  provider: string;
  metadata: Record<string, string>;
  /** Complete ShotState snapshot the image was generated from. */
  sourceState: ShotState;
}

interface EnhancedFrameStore {
  result: EnhancedFrameArtifact | null;
  setResult: (result: EnhancedFrameArtifact) => void;
  clearResult: () => void;
}

export const enhancedFrameStore = create<EnhancedFrameStore>((set) => ({
  result: null,
  setResult: (result) => set({ result }),
  clearResult: () => set({ result: null }),
}));

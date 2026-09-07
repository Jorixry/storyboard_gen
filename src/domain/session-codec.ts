/**
 * Versioned session envelope codec for browser-local persistence (Prompt 4 /
 * Phase 1 Day 4).
 *
 * Pure string <-> ShotState conversion only: this module never touches
 * localStorage, window or any browser API, so the codec is unit-testable in
 * plain Node. The storage adapter lives in src/state/session-persistence.ts.
 *
 * Safety rules:
 * - the envelope is explicitly versioned (version + kind);
 * - the payload is validated with the SAME canonical Zod schema used
 *   everywhere else (shotStateSchema), so a restore can never inject
 *   partially-valid or unknown-shape data;
 * - any malformed, future-version or schema-invalid input parses to `null`
 *   (safe fallback), never throws and never returns partial state;
 * - nothing except the canonical ShotState is persisted: no canvas, no
 *   screenshots, no Three.js objects, no prompts, no provider data, and no
 *   timestamps (keeps serialization deterministic).
 */
import { z } from "zod";

import { shotStateSchema, type ShotState } from "./shot-state";

export const SESSION_STORAGE_KEY = "storyboard-director.session.v1";

export const SESSION_ENVELOPE_VERSION = 1;

const sessionEnvelopeSchema = z.strictObject({
  kind: z.literal("storyboard-director-session"),
  version: z.literal(SESSION_ENVELOPE_VERSION),
  shotState: shotStateSchema,
});

export interface SerializedSession {
  kind: "storyboard-director-session";
  version: typeof SESSION_ENVELOPE_VERSION;
  shotState: ShotState;
}

export function serializeSession(shotState: ShotState): string {
  const envelope: SerializedSession = {
    kind: "storyboard-director-session",
    version: SESSION_ENVELOPE_VERSION,
    shotState,
  };
  return JSON.stringify(envelope);
}

/**
 * Parses persisted text back into a ShotState.
 * Returns null for malformed JSON, a wrong envelope kind, an unknown envelope
 * version or a schema-invalid payload — the caller then falls back safely.
 */
export function parseSession(raw: string | null | undefined): ShotState | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = sessionEnvelopeSchema.safeParse(parsed);
  return result.success ? result.data.shotState : null;
}

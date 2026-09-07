/**
 * Browser-local session persistence adapter (Prompt 4 / Phase 1 Day 4).
 *
 * localStorage only — no database, no account, no server call. The envelope
 * format and validation live in the pure codec
 * (src/domain/session-codec.ts); this module owns the browser boundary:
 * reading, writing, safe fallback and store wiring.
 *
 * Safety rules:
 * - every storage access is guarded for SSR (no window) and wrapped in
 *   try/catch so quota/security errors can never crash the app;
 * - malformed / future-version / schema-invalid / stale-template data falls
 *   back to null (and the key is cleared best-effort), never partially
 *   applied;
 * - a restored session keeps its ShotState ID, so a page refresh continues
 *   the same session;
 * - only the canonical ShotState is written — never canvas, screenshots,
 *   Three.js objects, prompts or provider data.
 */
import type { ShotTemplate } from "@/domain/shot-template";
import type { ShotState } from "@/domain/shot-state";
import { shotStateSchema } from "@/domain/shot-state";
import { parseSession, serializeSession, SESSION_STORAGE_KEY } from "@/domain/session-codec";

import type { ShotStoreApi } from "./shot-store";

export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Returns a localStorage-backed storage, or null outside the browser / on access failure. */
export function safeLocalStorage(): SessionStorage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const storage = window.localStorage;
    const probeKey = `${SESSION_STORAGE_KEY}.probe`;
    storage.setItem(probeKey, probeKey);
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

function clearSessionKey(storage: SessionStorage): void {
  try {
    storage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Best-effort cleanup only.
  }
}

/**
 * Reads and validates the persisted session.
 * Returns null (and clears the key best-effort) when the data is malformed,
 * from an unknown envelope version, schema-invalid, or does not match the
 * current compiled content: the template must exist with the SAME id, version
 * AND reviewStatus. A forged `approved` (or any drifted status) therefore
 * never restores — the current content still has no director-approved
 * template, so nothing persisted can claim otherwise.
 */
export function readPersistedSession(
  storage: SessionStorage,
  templates: readonly ShotTemplate[],
): ShotState | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
  const state = parseSession(raw);
  if (state === null) {
    clearSessionKey(storage);
    return null;
  }
  const templateStillExists = templates.some(
    (template) =>
      template.id === state.template.id &&
      template.version === state.template.version &&
      template.reviewStatus === state.template.reviewStatus,
  );
  if (!templateStillExists) {
    clearSessionKey(storage);
    return null;
  }
  return state;
}

/**
 * Persists the canonical ShotState after validating it against the SAME Zod
 * schema used everywhere else. An invalid state (e.g. a runtime-corrupted
 * focal length or aspect ratio) is NOT written: localStorage must never
 * become a channel for schema-invalid or forged data. Returns whether the
 * write happened.
 */
export function persistSession(storage: SessionStorage, shotState: ShotState): boolean {
  const validated = shotStateSchema.safeParse(shotState);
  if (!validated.success) {
    return false;
  }
  try {
    storage.setItem(SESSION_STORAGE_KEY, serializeSession(validated.data));
    return true;
  } catch {
    // Persistence is best-effort; editing continues in memory.
    return false;
  }
}

export interface AttachSessionPersistenceOptions {
  storage: SessionStorage;
  templates: readonly ShotTemplate[];
}

/**
 * Hydrates the store once from storage (marking it hydrated even when
 * nothing could be restored), then subscribes so every new canonical
 * ShotState is persisted. Returns a detach function for React effects.
 */
export function attachSessionPersistence(
  store: ShotStoreApi,
  options: AttachSessionPersistenceOptions,
): () => void {
  if (!store.getState().hydrated) {
    const restored = readPersistedSession(options.storage, options.templates);
    store.setState(
      restored === null ? { hydrated: true } : { shotState: restored, hydrated: true },
    );
  }
  return store.subscribe((state, previous) => {
    if (state.shotState !== previous.shotState && state.shotState !== null) {
      persistSession(options.storage, state.shotState);
    }
  });
}

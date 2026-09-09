/**
 * Browser-local session persistence adapter (Prompt 4 / Phase 1 Day 4).
 *
 * localStorage only — no database, no account, no server call. The envelope
 * format and validation live in the pure codec
 * (src/domain/session-codec.ts); this module owns the browser boundary:
 * reading, writing, safe fallback, store wiring and reporting the REAL
 * persistence outcome to the UI (never a claim based on hydration alone).
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

/**
 * Non-canonical UI status of local session persistence. This is footer
 * truthfulness only — never part of ShotState or any exportable state.
 * `pending` is the caller's initial state; the adapter reports every other
 * value: `unavailable` when storage cannot be used at all, `saved` /
 * `write_failed` per real write outcome.
 */
export type PersistenceStatus = "pending" | "saved" | "unavailable" | "write_failed";

/** The subset of statuses this adapter can report. */
export type PersistenceOutcome = Extract<
  PersistenceStatus,
  "saved" | "unavailable" | "write_failed"
>;

export interface AttachSessionPersistenceOptions {
  /** A storage, or null when the browser boundary says storage is unusable. */
  storage: SessionStorage | null;
  templates: readonly ShotTemplate[];
  /**
   * Optional UI status reporting: called with `unavailable` for null storage,
   * `saved` after a valid session is restored (it literally came from
   * storage) and after every persistSession outcome. Never called for a null
   * restore — the UI stays `pending` until the first real write.
   */
  onStatusChange?: (status: PersistenceOutcome) => void;
}

/**
 * Hydrates the store once from storage (marking it hydrated even when
 * nothing could be restored — and also when storage is null, in which case
 * `unavailable` is reported and nothing is ever written), then subscribes so
 * every new canonical ShotState is persisted. Status reporting is best-effort
 * UI information: a `write_failed` outcome never clears or rolls back the
 * in-memory state. Returns a detach function for React effects.
 */
export function attachSessionPersistence(
  store: ShotStoreApi,
  options: AttachSessionPersistenceOptions,
): () => void {
  const report = options.onStatusChange;
  if (options.storage === null) {
    if (!store.getState().hydrated) {
      store.setState({ hydrated: true });
    }
    report?.("unavailable");
    return () => {};
  }
  const storage = options.storage;
  if (!store.getState().hydrated) {
    const restored = readPersistedSession(storage, options.templates);
    store.setState(
      restored === null ? { hydrated: true } : { shotState: restored, hydrated: true },
    );
    if (restored !== null) {
      report?.("saved");
    }
  }
  return store.subscribe((state, previous) => {
    if (state.shotState !== previous.shotState && state.shotState !== null) {
      // Evaluate the write FIRST: `report?.(persistSession(...) ? ...)` would
      // short-circuit and skip the write entirely when no callback is given.
      const persisted = persistSession(storage, state.shotState);
      report?.(persisted ? "saved" : "write_failed");
    }
  });
}

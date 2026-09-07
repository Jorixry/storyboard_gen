import { describe, expect, it } from "vitest";

import { createSequenceIdFactory } from "@/domain/ids";
import { createShotStateFromTemplate, type ShotState } from "@/domain/shot-state";
import type { ShotTemplate } from "@/domain/shot-template";
import { serializeSession, SESSION_STORAGE_KEY } from "@/domain/session-codec";
import { createShotStore } from "@/state/shot-store";
import {
  attachSessionPersistence,
  persistSession,
  readPersistedSession,
  safeLocalStorage,
  type SessionStorage,
} from "@/state/session-persistence";
import { loadRealTemplates } from "../helpers/content-test-utils";

function memoryStorage(initial: Record<string, string> = {}): SessionStorage & {
  dump(): Record<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    dump: () => Object.fromEntries(data),
  };
}

async function realTemplates(): Promise<ShotTemplate[]> {
  return loadRealTemplates();
}

async function otsState(id: string): Promise<ShotState> {
  const templates = await realTemplates();
  const template = templates.find((t) => t.id === "dialogue_ots_a_to_b")!;
  return createShotStateFromTemplate(template, { generateId: () => id });
}

const ENGINEERING_READY_ONLY = ["engineering_ready"] as const;

describe("readPersistedSession", () => {
  it("restores a valid persisted session including the ShotState ID", async () => {
    const state = await otsState("persisted-1");
    const storage = memoryStorage({ [SESSION_STORAGE_KEY]: serializeSession(state) });
    const restored = readPersistedSession(storage, await realTemplates());
    expect(restored).toEqual(state);
    expect(restored!.id).toBe("persisted-1");
  });

  it("falls back to null and CLEARS the key for malformed data", async () => {
    const storage = memoryStorage({ [SESSION_STORAGE_KEY]: "{malformed" });
    expect(readPersistedSession(storage, await realTemplates())).toBeNull();
    expect(storage.dump()[SESSION_STORAGE_KEY]).toBeUndefined();
  });

  it("falls back to null and clears the key for version-mismatched data", async () => {
    const state = await otsState("persisted-2");
    const future = JSON.stringify({
      kind: "storyboard-director-session",
      version: 99,
      shotState: state,
    });
    const storage = memoryStorage({ [SESSION_STORAGE_KEY]: future });
    expect(readPersistedSession(storage, await realTemplates())).toBeNull();
    expect(storage.dump()[SESSION_STORAGE_KEY]).toBeUndefined();
  });

  it("falls back to null for schema-invalid payloads without partial state", async () => {
    const state = await otsState("persisted-3");
    const invalid = serializeSession({ ...state, camera: { ...state.camera, focalLengthMm: 500 } });
    const storage = memoryStorage({ [SESSION_STORAGE_KEY]: invalid });
    expect(readPersistedSession(storage, await realTemplates())).toBeNull();
  });

  it("falls back to null when the template id/version no longer exists in the content", async () => {
    const state = await otsState("persisted-4");
    const storage = memoryStorage({ [SESSION_STORAGE_KEY]: serializeSession(state) });
    // Content universe that no longer contains dialogue_ots_a_to_b v1.
    const otherTemplate = (await realTemplates()).find((t) => t.id === "dialogue_medium_two_shot")!;
    expect(readPersistedSession(storage, [otherTemplate])).toBeNull();
    expect(storage.dump()[SESSION_STORAGE_KEY]).toBeUndefined();

    // Same id but a newer version is ALSO incompatible for a restored session.
    const newer: ShotTemplate = {
      ...(await realTemplates()).find((t) => t.id === "dialogue_ots_a_to_b")!,
      version: 7,
    };
    const storage2 = memoryStorage({ [SESSION_STORAGE_KEY]: serializeSession(state) });
    expect(readPersistedSession(storage2, [newer])).toBeNull();
  });

  it("NEGATIVE: refuses a schema-valid but FORGED approved reviewStatus", async () => {
    const state = await otsState("forged-1");
    const forged = {
      ...state,
      template: { ...state.template, reviewStatus: "approved" as const },
    };
    // The forged state passes codec and schema (approved is a legal enum
    // value); only the compiled-content cross-check can catch it.
    const storage = memoryStorage({ [SESSION_STORAGE_KEY]: serializeSession(forged) });
    expect(readPersistedSession(storage, await realTemplates())).toBeNull();
    expect(storage.dump()[SESSION_STORAGE_KEY]).toBeUndefined();
  });

  it("NEGATIVE: refuses a session whose reviewStatus drifted from the compiled content", async () => {
    const state = await otsState("drifted-1"); // engineering_ready
    const storage = memoryStorage({ [SESSION_STORAGE_KEY]: serializeSession(state) });
    // Universe where that template has since become approved: the persisted
    // engineering_ready session no longer matches and is not restored.
    const promoted = (await realTemplates()).map((t) =>
      t.id === "dialogue_ots_a_to_b" ? { ...t, reviewStatus: "approved" as const } : t,
    );
    expect(readPersistedSession(storage, promoted)).toBeNull();
    expect(storage.dump()[SESSION_STORAGE_KEY]).toBeUndefined();
  });

  it("survives storage exceptions (returns null, never throws)", () => {
    const throwing: SessionStorage = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("quota");
      },
    };
    expect(readPersistedSession(throwing, [])).toBeNull();
  });

  it("safeLocalStorage returns null outside the browser", () => {
    expect(typeof window).toBe("undefined"); // unit suite runs in Node
    expect(safeLocalStorage()).toBeNull();
  });
});

describe("persistSession — full ShotState validation before any write", () => {
  it("NEGATIVE: refuses to write a schema-invalid focal length", async () => {
    const state = await otsState("bad-focal");
    const storage = memoryStorage();
    const invalid = { ...state, camera: { ...state.camera, focalLengthMm: 500 } };
    expect(persistSession(storage, invalid as ShotState)).toBe(false);
    expect(storage.dump()[SESSION_STORAGE_KEY]).toBeUndefined();
  });

  it("NEGATIVE: refuses to write an illegal aspect ratio", async () => {
    const state = await otsState("bad-aspect");
    const storage = memoryStorage();
    const invalid = { ...state, aspectRatio: "4:3" };
    expect(persistSession(storage, invalid as ShotState)).toBe(false);
    expect(storage.dump()[SESSION_STORAGE_KEY]).toBeUndefined();
  });

  it("NEGATIVE: refuses to write structurally broken or non-finite states", async () => {
    const state = await otsState("bad-shape");
    const storage = memoryStorage();
    expect(persistSession(storage, { ...state, movement: undefined } as unknown as ShotState)).toBe(
      false,
    );
    expect(
      persistSession(storage, {
        ...state,
        camera: { ...state.camera, position: [Number.NaN, 1.7, 2] },
      } as ShotState),
    ).toBe(false);
    expect(
      persistSession(storage, {
        ...state,
        characters: [state.characters[0]],
      } as unknown as ShotState),
    ).toBe(false);
    expect(storage.dump()[SESSION_STORAGE_KEY]).toBeUndefined();
  });

  it("writes a valid state and returns true", async () => {
    const state = await otsState("good-write");
    const storage = memoryStorage();
    expect(persistSession(storage, state)).toBe(true);
    expect(storage.dump()[SESSION_STORAGE_KEY]).toBe(serializeSession(state));
  });

  it("NEGATIVE: an invalid state injected into the store is never persisted", async () => {
    const templates = await realTemplates();
    const state = await otsState("injected-bad");
    const storage = memoryStorage();
    const store = createShotStore({
      templates,
      includeStatuses: ENGINEERING_READY_ONLY,
    });
    const detach = attachSessionPersistence(store, { storage, templates });
    try {
      // Simulates runtime corruption reaching the store anyway: the write
      // boundary must still refuse to let it into localStorage.
      store.setState({
        shotState: { ...state, aspectRatio: "21:9" } as unknown as ShotState,
      });
      expect(storage.dump()[SESSION_STORAGE_KEY]).toBeUndefined();

      // The next VALID state is written normally again.
      store.getState().selectTemplate("dialogue_ots_a_to_b");
      expect(storage.dump()[SESSION_STORAGE_KEY]).toBeDefined();
    } finally {
      detach();
    }
  });
});

describe("attachSessionPersistence", () => {
  it("hydrates the store once, marks it hydrated, and persists new canonical states", async () => {
    const templates = await realTemplates();
    const state = await otsState("hydrate-1");
    const storage = memoryStorage({ [SESSION_STORAGE_KEY]: serializeSession(state) });
    const store = createShotStore({
      templates,
      includeStatuses: ENGINEERING_READY_ONLY,
      generateId: createSequenceIdFactory("attach"),
    });

    const detach = attachSessionPersistence(store, { storage, templates });
    try {
      expect(store.getState().hydrated).toBe(true);
      expect(store.getState().shotState?.id).toBe("hydrate-1");

      // A command rewrites the canonical state -> the storage is updated.
      store.getState().makeCloser();
      const saved = JSON.parse(storage.dump()[SESSION_STORAGE_KEY]) as {
        shotState: ShotState;
      };
      expect(saved.shotState.id).toBe("hydrate-1");
      expect(saved.shotState.camera.position[2]).toBeCloseTo(1.6, 10);

      // A template re-selection persists the NEW id as well.
      store.getState().selectTemplate("dialogue_medium_two_shot");
      const saved2 = JSON.parse(storage.dump()[SESSION_STORAGE_KEY]) as {
        shotState: ShotState;
      };
      expect(saved2.shotState.id).toBe("attach-1");
      expect(saved2.shotState.template.id).toBe("dialogue_medium_two_shot");
    } finally {
      detach();
    }
  });

  it("marks the store hydrated even when nothing could be restored", async () => {
    const templates = await realTemplates();
    const storage = memoryStorage({ [SESSION_STORAGE_KEY]: "garbage" });
    const store = createShotStore({ templates, includeStatuses: ENGINEERING_READY_ONLY });
    const detach = attachSessionPersistence(store, { storage, templates });
    detach();
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().shotState).toBeNull();
    expect(storage.dump()[SESSION_STORAGE_KEY]).toBeUndefined();
  });

  it("does not double-hydrate: a second attach keeps the live session", async () => {
    const templates = await realTemplates();
    const state = await otsState("hydrate-2");
    const storage = memoryStorage({ [SESSION_STORAGE_KEY]: serializeSession(state) });
    const store = createShotStore({ templates, includeStatuses: ENGINEERING_READY_ONLY });
    const detach1 = attachSessionPersistence(store, { storage, templates });
    store.getState().selectTemplate("dialogue_medium_two_shot"); // id: default UUID
    const detach2 = attachSessionPersistence(store, { storage, templates });
    try {
      // The second attach must NOT roll the store back to the stored session.
      expect(store.getState().shotState?.template.id).toBe("dialogue_medium_two_shot");
    } finally {
      detach1();
      detach2();
    }
  });

  it("stops persisting after detach", async () => {
    const templates = await realTemplates();
    const storage = memoryStorage();
    const store = createShotStore({
      templates,
      includeStatuses: ENGINEERING_READY_ONLY,
      generateId: createSequenceIdFactory("detach"),
    });
    const detach = attachSessionPersistence(store, { storage, templates });
    detach();
    store.getState().selectTemplate("dialogue_ots_a_to_b");
    expect(storage.dump()[SESSION_STORAGE_KEY]).toBeUndefined();
  });
});

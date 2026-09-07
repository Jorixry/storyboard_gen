/**
 * Canonical shot-state store factory (Prompt 4 / Phase 1 Day 4).
 *
 * ONE store owns the single canonical ShotState. Simple semantic controls and
 * the advanced 3D refinement both dispatch the SAME framework-independent
 * domain commands here; React local state never duplicates camera, characters
 * or scene data, and Three.js keeps reading the state through the stage
 * projection only.
 *
 * Built on the vanilla zustand store (a direct dependency, per
 * docs/ARCHITECTURE.md; NOT an R3F transitive): the factory has no React
 * import and is fully unit-testable in plain Node. The application singleton
 * that binds the compiled content lives in app-shot-store.ts; tests inject
 * their own templates and deterministic ID factories here.
 *
 * Command errors (invalid input, degenerate geometry, character overlap)
 * propagate to the caller and leave the state untouched.
 */
import { createStore } from "zustand/vanilla";

import { loadDevelopmentTemplates } from "@/content/loader";
import { defaultShotStateIdFactory, type ShotStateIdFactory } from "@/domain/ids";
import type { ReviewStatus, ShotTemplate } from "@/domain/shot-template";
import type { ShotState } from "@/domain/shot-state";
import type { AspectRatio, CharacterId, Vec3 } from "@/domain/schemas";
import {
  emphasizeCharacter,
  makeCloser,
  makeFarther,
  resetShotStateToTemplate,
  setAspectRatio,
  setCameraFocalLength,
  setCameraPosition,
  setCameraTarget,
  setCharacterPosition,
  setCharacterYaw,
  setFocalFeel,
} from "@/domain/commands";
import type { FocalFeelPresetId } from "@/domain/engineering-constraints";
import { createShotStateFromTemplate } from "@/domain/shot-state";

export class UnknownTemplateError extends Error {
  constructor(
    readonly templateId: string,
    readonly includeStatuses: readonly ReviewStatus[],
  ) {
    super(
      `template "${templateId}" is not loadable with includeStatuses=[${includeStatuses.join(", ")}]`,
    );
    this.name = "UnknownTemplateError";
  }
}

export class NoShotStateError extends Error {
  constructor() {
    super("no ShotState is loaded; select a template first");
    this.name = "NoShotStateError";
  }
}

export interface ShotStoreDeps {
  /** Compiled template universe (injected; tests pass fixtures). */
  templates: readonly ShotTemplate[];
  /**
   * Explicit development-loader opt-in, exactly like tests. The application
   * gallery passes ["engineering_ready"]; the production loader is never used
   * by this store and keeps returning zero templates for current content.
   */
  includeStatuses: readonly ReviewStatus[];
  /** Deterministic ID factory override for tests. */
  generateId?: ShotStateIdFactory;
}

export interface ShotStore {
  /** The single canonical ShotState; null until a template is selected/restored. */
  shotState: ShotState | null;
  /** True once the initial localStorage hydration attempt has finished. */
  hydrated: boolean;
  /** Loads a template through the development opt-in; mints a NEW ShotState ID. */
  selectTemplate(templateId: string): void;
  makeCloser(): void;
  makeFarther(): void;
  emphasizeCharacter(characterId: CharacterId): void;
  setFocalFeel(preset: FocalFeelPresetId): void;
  setAspectRatio(aspectRatio: AspectRatio): void;
  setCameraPosition(position: Vec3): void;
  setCameraTarget(target: Vec3): void;
  setCameraFocalLength(focalLengthMm: number): void;
  setCharacterPosition(characterId: CharacterId, position: Vec3): void;
  setCharacterYaw(characterId: CharacterId, yawDeg: number): void;
  /** Restores template values while KEEPING the current ShotState ID. */
  resetToTemplate(): void;
}

export type ShotStoreApi = ReturnType<typeof createShotStore>;

export function createShotStore(deps: ShotStoreDeps) {
  const generateId = deps.generateId ?? defaultShotStateIdFactory;

  const findLoadableTemplate = (templateId: string): ShotTemplate => {
    const loadable = loadDevelopmentTemplates(deps.templates, {
      includeStatuses: deps.includeStatuses,
    });
    const template = loadable.find((candidate) => candidate.id === templateId);
    if (template === undefined) {
      throw new UnknownTemplateError(templateId, deps.includeStatuses);
    }
    return template;
  };

  const applyCommand = (command: (state: ShotState) => ShotState): void => {
    const current = store.getState().shotState;
    if (current === null) {
      throw new NoShotStateError();
    }
    store.setState({ shotState: command(current) });
  };

  const store = createStore<ShotStore>()((set, get) => ({
    shotState: null,
    hydrated: false,
    selectTemplate: (templateId) => {
      const template = findLoadableTemplate(templateId);
      set({ shotState: createShotStateFromTemplate(template, { generateId }) });
    },
    makeCloser: () => applyCommand(makeCloser),
    makeFarther: () => applyCommand(makeFarther),
    emphasizeCharacter: (characterId) =>
      applyCommand((state) => emphasizeCharacter(state, characterId)),
    setFocalFeel: (preset) => applyCommand((state) => setFocalFeel(state, preset)),
    setAspectRatio: (aspectRatio) => applyCommand((state) => setAspectRatio(state, aspectRatio)),
    setCameraPosition: (position) => applyCommand((state) => setCameraPosition(state, position)),
    setCameraTarget: (target) => applyCommand((state) => setCameraTarget(state, target)),
    setCameraFocalLength: (focalLengthMm) =>
      applyCommand((state) => setCameraFocalLength(state, focalLengthMm)),
    setCharacterPosition: (characterId, position) =>
      applyCommand((state) => setCharacterPosition(state, characterId, position)),
    setCharacterYaw: (characterId, yawDeg) =>
      applyCommand((state) => setCharacterYaw(state, characterId, yawDeg)),
    resetToTemplate: () => {
      const current = get().shotState;
      if (current === null) {
        throw new NoShotStateError();
      }
      const template = findLoadableTemplate(current.template.id);
      if (template.version !== current.template.version) {
        // Content moved on since this session was created: refuse rather than
        // silently resetting to a different template version.
        throw new UnknownTemplateError(current.template.id, deps.includeStatuses);
      }
      set({ shotState: resetShotStateToTemplate(current, template) });
    },
  }));

  return store;
}

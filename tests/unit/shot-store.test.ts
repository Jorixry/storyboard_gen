import { describe, expect, it } from "vitest";

import { loadDevelopmentTemplates, loadProductionTemplates } from "@/content/loader";
import { createSequenceIdFactory } from "@/domain/ids";
import { DegenerateCameraGeometryError, InvalidCommandInputError } from "@/domain/commands";
import type { ShotTemplate } from "@/domain/shot-template";
import { createShotStore, NoShotStateError, UnknownTemplateError } from "@/state/shot-store";
import { loadRealTemplates } from "../helpers/content-test-utils";

const ENGINEERING_READY_ONLY = ["engineering_ready"] as const;

async function realStore() {
  const templates = await loadRealTemplates();
  const store = createShotStore({
    templates,
    includeStatuses: ENGINEERING_READY_ONLY,
    generateId: createSequenceIdFactory("store"),
  });
  return { store, templates };
}

describe("createShotStore — template selection through the development opt-in", () => {
  it("starts empty and unhydrated", async () => {
    const { store } = await realStore();
    expect(store.getState().shotState).toBeNull();
    expect(store.getState().hydrated).toBe(false);
  });

  it("selects a loadable template and mints a NEW ShotState ID each time", async () => {
    const { store } = await realStore();
    store.getState().selectTemplate("dialogue_ots_a_to_b");
    const first = store.getState().shotState!;
    expect(first.id).toBe("store-1");
    expect(first.template).toEqual({
      id: "dialogue_ots_a_to_b",
      version: 1,
      reviewStatus: "engineering_ready",
    });
    expect(first.characters.map((c) => c.id).sort()).toEqual(["character_a", "character_b"]);

    store.getState().selectTemplate("dialogue_ots_a_to_b");
    expect(store.getState().shotState!.id).toBe("store-2");
    expect(store.getState().shotState!.id).not.toBe(first.id);
  });

  it("rejects unknown template ids and refuses approved-only access to engineering content", async () => {
    const templates = await loadRealTemplates();
    const store = createShotStore({
      templates,
      includeStatuses: ENGINEERING_READY_ONLY,
    });
    expect(() => store.getState().selectTemplate("dialogue_ots_75mm_comparison")).toThrow(
      UnknownTemplateError,
    );

    const approvedOnly = createShotStore({ templates, includeStatuses: ["approved"] });
    expect(() => approvedOnly.getState().selectTemplate("dialogue_ots_a_to_b")).toThrow(
      UnknownTemplateError,
    );
  });

  it("the production loader still returns zero templates for this content", async () => {
    const templates = await loadRealTemplates();
    expect(loadProductionTemplates(templates)).toEqual([]);
    expect(
      loadDevelopmentTemplates(templates, { includeStatuses: ENGINEERING_READY_ONLY }),
    ).toHaveLength(3);
  });

  it("does not mutate the injected template universe", async () => {
    const { store, templates } = await realStore();
    const before = JSON.parse(JSON.stringify(templates)) as unknown;
    store.getState().selectTemplate("dialogue_medium_two_shot");
    store.getState().makeCloser();
    store.getState().resetToTemplate();
    expect(JSON.parse(JSON.stringify(templates))).toEqual(before);
  });
});

describe("createShotStore — command actions", () => {
  it("requires a ShotState before any command runs", async () => {
    const { store } = await realStore();
    expect(() => store.getState().makeCloser()).toThrow(NoShotStateError);
    expect(() => store.getState().resetToTemplate()).toThrow(NoShotStateError);
  });

  it("makeCloser/makeFarther update camera position through the domain command", async () => {
    const { store } = await realStore();
    store.getState().selectTemplate("dialogue_medium_two_shot");
    const before = store.getState().shotState!;
    store.getState().makeCloser();
    const closer = store.getState().shotState!;
    expect(closer.camera.position[2]).toBeCloseTo(2.72, 10);
    expect(closer.camera.target).toEqual(before.camera.target);
    expect(closer.movement).toBe(before.movement);

    store.getState().makeFarther();
    expect(store.getState().shotState!.camera.position[2]).toBeCloseTo(3.264, 10);
  });

  it("emphasize and focal feel write their typed fields", async () => {
    const { store } = await realStore();
    store.getState().selectTemplate("dialogue_medium_two_shot");
    store.getState().emphasizeCharacter("character_b");
    expect(store.getState().shotState!.camera.target[0]).toBeCloseTo(0.4, 10);

    store.getState().setFocalFeel("portrait");
    expect(store.getState().shotState!.camera.focalLengthMm).toBe(50);

    store.getState().setAspectRatio("9:16");
    expect(store.getState().shotState!.aspectRatio).toBe("9:16");
  });

  it("constrained transforms clamp and update the canonical state", async () => {
    const { store } = await realStore();
    store.getState().selectTemplate("dialogue_ots_a_to_b");
    store.getState().setCameraPosition([999, 999, 999]);
    expect(store.getState().shotState!.camera.position).toEqual([2.9, 2.7, 4.4]);

    store.getState().setCameraFocalLength(500);
    expect(store.getState().shotState!.camera.focalLengthMm).toBe(200);

    store.getState().setCharacterYaw("character_a", 270);
    expect(
      store.getState().shotState!.characters.find((c) => c.id === "character_a")!.rotationYDeg,
    ).toBe(-90);
  });

  it("NEGATIVE: rejects an illegal aspect ratio at runtime and keeps the state untouched", async () => {
    const { store } = await realStore();
    store.getState().selectTemplate("dialogue_medium_two_shot");
    const before = store.getState().shotState!;
    expect(() =>
      store
        .getState()
        .setAspectRatio(
          "4:3" as Parameters<ReturnType<typeof store.getState>["setAspectRatio"]>[0],
        ),
    ).toThrow(InvalidCommandInputError);
    expect(store.getState().shotState).toBe(before);
    expect(store.getState().shotState!.aspectRatio).toBe("16:9");
  });

  it("synchronizes canonical semantics through the store actions", async () => {
    const { store } = await realStore();
    store.getState().selectTemplate("dialogue_medium_two_shot");
    store.getState().setFocalFeel("portrait");
    expect(store.getState().shotState!.semantics.optics).toContain("focal_50mm");
    expect(store.getState().shotState!.semantics.optics).not.toContain("focal_35mm");
    store.getState().emphasizeCharacter("character_b");
    expect(store.getState().shotState!.semantics.subjects).toContain("character_b_primary");
    expect(store.getState().shotState!.semantics.subjects).not.toContain(
      "character_a_and_character_b_equal_prominence",
    );
  });

  it("propagates command errors and leaves the state untouched", async () => {
    const { store } = await realStore();
    store.getState().selectTemplate("dialogue_medium_two_shot");
    const before = store.getState().shotState!;
    expect(() => store.getState().setCharacterPosition("character_b", [-0.5, 0, 0])).toThrow();
    expect(store.getState().shotState).toBe(before);

    // Degenerate direct transform:
    expect(() => store.getState().setCameraTarget([0.01, 1.6, 3.4])).toThrow(
      DegenerateCameraGeometryError,
    );
    expect(store.getState().shotState).toBe(before);
  });
});

describe("createShotStore — resetToTemplate", () => {
  it("restores template values while KEEPING the current ShotState ID", async () => {
    const { store } = await realStore();
    store.getState().selectTemplate("dialogue_ots_a_to_b");
    const idBeforeEdits = store.getState().shotState!.id;
    store.getState().makeCloser();
    store.getState().setFocalFeel("compressed");
    store.getState().setAspectRatio("9:16");
    store.getState().emphasizeCharacter("character_a");

    store.getState().resetToTemplate();
    const reset = store.getState().shotState!;
    expect(reset.id).toBe(idBeforeEdits);
    expect(reset.aspectRatio).toBe("16:9");
    expect(reset.camera.focalLengthMm).toBe(75);
    expect(reset.camera.position).toEqual([-1.25, 1.7, 2]);
    expect(reset.camera.target).toEqual([0.8, 1.55, 0]);
    expect(reset.movement.start.focalLengthMm).toBe(75);
  });

  it("refuses reset when the session's template version no longer exists", async () => {
    const templates = await loadRealTemplates();
    const templateV1 = templates.find((t) => t.id === "dialogue_ots_a_to_b")!;
    const templateV2: ShotTemplate = { ...templateV1, version: 2 };
    // Session created from v1, but current content only has v2.
    const store = createShotStore({
      templates: [templateV2],
      includeStatuses: ENGINEERING_READY_ONLY,
      generateId: createSequenceIdFactory("stale"),
    });
    // Seed the store with a v1 state directly (simulating a restored session).
    const { createShotStateFromTemplate } = await import("@/domain/shot-state");
    store.setState({
      shotState: createShotStateFromTemplate(templateV1, {
        generateId: createSequenceIdFactory("stale"),
      }),
    });
    expect(() => store.getState().resetToTemplate()).toThrow(UnknownTemplateError);
  });
});

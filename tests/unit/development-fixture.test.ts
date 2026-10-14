import { describe, expect, it } from "vitest";

import { loadProductionTemplates } from "@/content/loader";
import { createSequenceIdFactory } from "@/domain/ids";
import {
  FixtureTemplateNotLoadableError,
  resolveDevelopmentFixture,
} from "@/features/rendering/development-fixture";
import { loadRealTemplates } from "../helpers/content-test-utils";

const DEVELOPMENT_STATUSES = ["engineering_ready", "approved"] as const;

const UUIDV4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("resolveDevelopmentFixture — explicit opt-in", () => {
  it("loads the labeled development fixture through the development loader", async () => {
    const templates = await loadRealTemplates();
    const fixture = resolveDevelopmentFixture(templates, {
      templateId: "dialogue_ots_a_to_b",
      includeStatuses: DEVELOPMENT_STATUSES,
    });
    expect(fixture.template.id).toBe("dialogue_ots_a_to_b");
    expect(fixture.template.reviewStatus).toBe("approved"); // D031
    expect(fixture.shotState.template).toEqual({
      id: "dialogue_ots_a_to_b",
      version: 3, // OTS v3 (D029 camera reposition; v2 was D025 75mm)
      reviewStatus: "approved", // D031 written approval 2026-10-11
    });
    expect(fixture.isDirectorApproved).toBe(true);
  });

  it("keeps the OTS development fixture at the D025-confirmed 75mm", async () => {
    const templates = await loadRealTemplates();
    for (const templateId of ["dialogue_ots_a_to_b", "dialogue_ots_b_to_a"]) {
      const fixture = resolveDevelopmentFixture(templates, {
        templateId,
        includeStatuses: DEVELOPMENT_STATUSES,
      });
      expect(fixture.shotState.camera.focalLengthMm).toBe(75);
      expect(fixture.shotState.movement.start.focalLengthMm).toBe(75);
      expect(fixture.shotState.movement.end.focalLengthMm).toBe(75);
    }
  });

  it("creates a canonical ShotState with characters exactly a and b (injected IDs)", async () => {
    const templates = await loadRealTemplates();
    const fixture = resolveDevelopmentFixture(templates, {
      templateId: "dialogue_ots_a_to_b",
      includeStatuses: DEVELOPMENT_STATUSES,
      generateId: createSequenceIdFactory("dev-fixture"),
    });
    expect(fixture.shotState.id).toBe("dev-fixture-1");
    expect(fixture.shotState.characters).toEqual([
      { id: "character_a", position: [-0.8, 0, 0], rotationYDeg: 90 },
      { id: "character_b", position: [0.8, 0, 0], rotationYDeg: -90 },
    ]);
  });

  it("generates a different unique ShotState ID for every default load", async () => {
    const templates = await loadRealTemplates();
    const first = resolveDevelopmentFixture(templates, {
      templateId: "dialogue_ots_a_to_b",
      includeStatuses: DEVELOPMENT_STATUSES,
    });
    const second = resolveDevelopmentFixture(templates, {
      templateId: "dialogue_ots_a_to_b",
      includeStatuses: DEVELOPMENT_STATUSES,
    });
    // Default loads use the production UUIDv4 factory: every template load is
    // a fresh ShotState, never a colliding reused ID.
    expect(first.shotState.id).toMatch(UUIDV4_PATTERN);
    expect(second.shotState.id).toMatch(UUIDV4_PATTERN);
    expect(first.shotState.id).not.toBe(second.shotState.id);
  });

  it("honors a shared injected sequence factory by advancing its counter", async () => {
    const templates = await loadRealTemplates();
    const generateId = createSequenceIdFactory("dev-fixture");
    const first = resolveDevelopmentFixture(templates, {
      templateId: "dialogue_ots_a_to_b",
      includeStatuses: DEVELOPMENT_STATUSES,
      generateId,
    });
    const second = resolveDevelopmentFixture(templates, {
      templateId: "dialogue_ots_b_to_a",
      includeStatuses: DEVELOPMENT_STATUSES,
      generateId,
    });
    expect(first.shotState.id).toBe("dev-fixture-1");
    expect(second.shotState.id).toBe("dev-fixture-2");
  });

  it("refuses the fixture without an explicit opt-in", async () => {
    const templates = await loadRealTemplates();
    expect(() =>
      resolveDevelopmentFixture(templates, {
        templateId: "dialogue_ots_a_to_b",
        includeStatuses: [],
      }),
    ).toThrow(FixtureTemplateNotLoadableError);

    // An approved-only request must not leak engineering_ready content (the
    // medium template after D031); the approved OTS pair loads there fine.
    expect(() =>
      resolveDevelopmentFixture(templates, {
        templateId: "dialogue_medium_two_shot",
        includeStatuses: ["approved"],
      }),
    ).toThrow(FixtureTemplateNotLoadableError);
  });

  it("refuses unknown template ids even with the opt-in", async () => {
    const templates = await loadRealTemplates();
    expect(() =>
      resolveDevelopmentFixture(templates, {
        templateId: "dialogue_ots_75mm_comparison",
        includeStatuses: DEVELOPMENT_STATUSES,
      }),
    ).toThrow(FixtureTemplateNotLoadableError);
  });

  it("does not mutate the source templates", async () => {
    const templates = await loadRealTemplates();
    const before = JSON.parse(JSON.stringify(templates)) as unknown;
    resolveDevelopmentFixture(templates, {
      templateId: "dialogue_ots_a_to_b",
      includeStatuses: DEVELOPMENT_STATUSES,
    });
    expect(JSON.parse(JSON.stringify(templates))).toEqual(before);
  });
});

describe("production boundary", () => {
  it("returns exactly the two D031-approved OTS templates", async () => {
    const templates = await loadRealTemplates();
    const production = loadProductionTemplates(templates);
    expect(production.map((t) => t.id)).toEqual(["dialogue_ots_a_to_b", "dialogue_ots_b_to_a"]);
  });
});

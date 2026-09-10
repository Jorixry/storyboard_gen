import { describe, expect, it } from "vitest";

import { loadProductionTemplates } from "@/content/loader";
import { createSequenceIdFactory } from "@/domain/ids";
import {
  FixtureTemplateNotLoadableError,
  resolveDevelopmentFixture,
} from "@/features/rendering/development-fixture";
import { loadRealTemplates } from "../helpers/content-test-utils";

const ENGINEERING_READY_ONLY = ["engineering_ready"] as const;

const UUIDV4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("resolveDevelopmentFixture — explicit engineering_ready opt-in", () => {
  it("loads the labeled development fixture through the development loader", async () => {
    const templates = await loadRealTemplates();
    const fixture = resolveDevelopmentFixture(templates, {
      templateId: "dialogue_ots_a_to_b",
      includeStatuses: ENGINEERING_READY_ONLY,
    });
    expect(fixture.template.id).toBe("dialogue_ots_a_to_b");
    expect(fixture.template.reviewStatus).toBe("engineering_ready");
    expect(fixture.shotState.template).toEqual({
      id: "dialogue_ots_a_to_b",
      version: 1,
      reviewStatus: "engineering_ready",
    });
    expect(fixture.isDirectorApproved).toBe(false);
  });

  it("keeps the OTS development fixture at the director-ruled 75mm", async () => {
    const templates = await loadRealTemplates();
    for (const templateId of ["dialogue_ots_a_to_b", "dialogue_ots_b_to_a"]) {
      const fixture = resolveDevelopmentFixture(templates, {
        templateId,
        includeStatuses: ENGINEERING_READY_ONLY,
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
      includeStatuses: ENGINEERING_READY_ONLY,
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
      includeStatuses: ENGINEERING_READY_ONLY,
    });
    const second = resolveDevelopmentFixture(templates, {
      templateId: "dialogue_ots_a_to_b",
      includeStatuses: ENGINEERING_READY_ONLY,
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
      includeStatuses: ENGINEERING_READY_ONLY,
      generateId,
    });
    const second = resolveDevelopmentFixture(templates, {
      templateId: "dialogue_ots_b_to_a",
      includeStatuses: ENGINEERING_READY_ONLY,
      generateId,
    });
    expect(first.shotState.id).toBe("dev-fixture-1");
    expect(second.shotState.id).toBe("dev-fixture-2");
  });

  it("refuses the fixture without an explicit engineering_ready opt-in", async () => {
    const templates = await loadRealTemplates();
    expect(() =>
      resolveDevelopmentFixture(templates, {
        templateId: "dialogue_ots_a_to_b",
        includeStatuses: [],
      }),
    ).toThrow(FixtureTemplateNotLoadableError);

    // An approved-only request must not leak engineering_ready content.
    expect(() =>
      resolveDevelopmentFixture(templates, {
        templateId: "dialogue_ots_a_to_b",
        includeStatuses: ["approved"],
      }),
    ).toThrow(FixtureTemplateNotLoadableError);
  });

  it("refuses unknown template ids even with the opt-in", async () => {
    const templates = await loadRealTemplates();
    expect(() =>
      resolveDevelopmentFixture(templates, {
        templateId: "dialogue_ots_75mm_comparison",
        includeStatuses: ENGINEERING_READY_ONLY,
      }),
    ).toThrow(FixtureTemplateNotLoadableError);
  });

  it("does not mutate the source templates", async () => {
    const templates = await loadRealTemplates();
    const before = JSON.parse(JSON.stringify(templates)) as unknown;
    resolveDevelopmentFixture(templates, {
      templateId: "dialogue_ots_a_to_b",
      includeStatuses: ENGINEERING_READY_ONLY,
    });
    expect(JSON.parse(JSON.stringify(templates))).toEqual(before);
  });
});

describe("production boundary remains closed", () => {
  it("still returns zero templates for the current (engineering_ready-only) content", async () => {
    const templates = await loadRealTemplates();
    expect(loadProductionTemplates(templates)).toEqual([]);
  });
});

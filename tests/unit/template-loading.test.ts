import { describe, expect, it } from "vitest";

import type { ShotTemplate } from "@/domain/shot-template";
import { loadDevelopmentTemplates, loadProductionTemplates } from "@/content/loader";
import { loadRealTemplates } from "../helpers/content-test-utils";

/** In-memory template with an overridable review status (canonical content untouched). */
function templateWithStatus(id: string, reviewStatus: ShotTemplate["reviewStatus"]): ShotTemplate {
  return {
    id,
    version: 1,
    reviewStatus,
    display: {
      nameZh: "测试",
      plainDescriptionZh: "测试",
      narrativePurposeZh: "测试",
      emotionalEffectsZh: ["中性"],
      whenToUseZh: "测试",
      referenceImage: "/reference-images/x.png",
      referenceRightsNote: "测试",
    },
    scene: { presetId: "dialogue_room", aspectRatio: "16:9" },
    characters: [
      { id: "character_a", position: [-0.8, 0, 0], rotationYDeg: 90 },
      { id: "character_b", position: [0.8, 0, 0], rotationYDeg: -90 },
    ],
    camera: {
      position: [0, 1.6, 3.4],
      target: [0, 1.55, 0],
      focalLengthMm: 35,
      shotSize: "medium_two_shot",
    },
    movement: {
      type: "static",
      start: { position: [0, 1.6, 3.4], target: [0, 1.55, 0], focalLengthMm: 35 },
      end: { position: [0, 1.6, 3.4], target: [0, 1.55, 0], focalLengthMm: 35 },
      durationSeconds: 4,
      easing: "linear",
    },
    directorRuleIds: ["maintain_axis"],
    promptSemantics: {
      subjects: ["both_equal"],
      composition: ["medium_two_shot"],
      optics: ["focal_35mm"],
      motion: ["static_camera"],
      continuity: ["maintain_axis"],
    },
    acceptance: ["验收条目"],
  };
}

describe("production loader boundary", () => {
  it("returns zero templates for the current real content (all engineering_ready)", async () => {
    const templates = await loadRealTemplates();
    expect(templates).toHaveLength(3);
    const production = loadProductionTemplates(templates);
    expect(production).toEqual([]);
  });

  it("excludes every reviewStatus except approved", () => {
    const nonApprovedStatuses: ShotTemplate["reviewStatus"][] = [
      "draft",
      "engineering_placeholder",
      "engineering_ready",
      "director_review",
      "deprecated",
    ];
    for (const status of nonApprovedStatuses) {
      const templates = [templateWithStatus(`template_${status}`, status)];
      expect(loadProductionTemplates(templates), status).toEqual([]);
    }
  });

  it("includes approved templates only", () => {
    const templates = [
      templateWithStatus("template_approved", "approved"),
      templateWithStatus("template_engineering", "engineering_ready"),
    ];
    const production = loadProductionTemplates(templates);
    expect(production.map((template) => template.id)).toEqual(["template_approved"]);
  });
});

describe("development/test loader boundary", () => {
  it("loads the three engineering_ready templates only with an explicit opt-in", async () => {
    const templates = await loadRealTemplates();
    const loaded = loadDevelopmentTemplates(templates, {
      includeStatuses: ["engineering_ready"],
    });
    expect(loaded).toHaveLength(3);
    expect(loaded.every((template) => template.reviewStatus === "engineering_ready")).toBe(true);
    expect(loaded.map((template) => template.id)).toEqual([
      "dialogue_medium_two_shot",
      "dialogue_ots_a_to_b",
      "dialogue_ots_b_to_a",
    ]);
  });

  it("loads nothing without an explicit status list (no implicit defaults)", async () => {
    const templates = await loadRealTemplates();
    expect(loadDevelopmentTemplates(templates, { includeStatuses: [] })).toEqual([]);
  });

  it("does not leak engineering_ready templates through an approved-only request", async () => {
    const templates = await loadRealTemplates();
    const loaded = loadDevelopmentTemplates(templates, { includeStatuses: ["approved"] });
    expect(loaded).toEqual([]);
  });

  it("honors exactly the statuses that are named", () => {
    const templates = [
      templateWithStatus("template_a", "engineering_ready"),
      templateWithStatus("template_b", "draft"),
      templateWithStatus("template_c", "approved"),
    ];
    const loaded = loadDevelopmentTemplates(templates, {
      includeStatuses: ["engineering_ready", "draft"],
    });
    expect(loaded.map((template) => template.id)).toEqual(["template_a", "template_b"]);
  });
});

describe("loader determinism", () => {
  it("returns templates sorted by id regardless of input order", async () => {
    const templates = (await loadRealTemplates()).slice().reverse();
    const loaded = loadDevelopmentTemplates(templates, { includeStatuses: ["engineering_ready"] });
    expect(loaded.map((template) => template.id)).toEqual([
      "dialogue_medium_two_shot",
      "dialogue_ots_a_to_b",
      "dialogue_ots_b_to_a",
    ]);
  });
});

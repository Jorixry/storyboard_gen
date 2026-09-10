import { describe, expect, it } from "vitest";

import {
  aspectRatioSchema,
  cameraPoseSchema,
  charactersSchema,
  focalLengthSchema,
  movementStateSchema,
  vec3Schema,
} from "@/domain/schemas";
import { shotTemplateSchema } from "@/domain/shot-template";
import type { ZodIssue } from "zod";

/**
 * Minimal structurally valid template record used as the base for
 * domain-level negative cases (in-memory objects only; canonical content is
 * never modified).
 */
function minimalTemplateRecord(): Record<string, unknown> {
  return {
    id: "test_template",
    version: 1,
    reviewStatus: "engineering_ready",
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

function parseTemplate(record: unknown) {
  return shotTemplateSchema.safeParse(record);
}

function firstIssuePath(issues: ZodIssue[]): string {
  return `/${issues[0].path.map(String).join("/")}`;
}

describe("vec3Schema", () => {
  it("accepts a finite three-number tuple", () => {
    expect(vec3Schema.safeParse([0, 1.6, 3.4]).success).toBe(true);
  });

  it("rejects a tuple with the wrong length", () => {
    expect(vec3Schema.safeParse([0, 1.6]).success).toBe(false);
    expect(vec3Schema.safeParse([0, 1.6, 3.4, 5]).success).toBe(false);
  });

  it("rejects string components", () => {
    const result = vec3Schema.safeParse(["0.0", 1.6, 3.4]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstIssuePath(result.error.issues)).toBe("/0");
    }
  });

  it("rejects NaN components", () => {
    const result = vec3Schema.safeParse([Number.NaN, 1.6, 3.4]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstIssuePath(result.error.issues)).toBe("/0");
      expect(result.error.issues[0].message.length).toBeGreaterThan(0);
    }
  });

  it("rejects Infinity components", () => {
    const result = vec3Schema.safeParse([0, Number.POSITIVE_INFINITY, 3.4]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstIssuePath(result.error.issues)).toBe("/1");
    }
  });
});

describe("focalLengthSchema", () => {
  it("accepts the Schema bounds 12 and 200 plus the OTS 75mm and preset 50mm values", () => {
    expect(focalLengthSchema.safeParse(12).success).toBe(true);
    expect(focalLengthSchema.safeParse(200).success).toBe(true);
    expect(focalLengthSchema.safeParse(75).success).toBe(true); // OTS v2 default (D025)
    expect(focalLengthSchema.safeParse(50).success).toBe(true); // portrait focal-feel preset
  });

  it("rejects values outside the Schema range", () => {
    expect(focalLengthSchema.safeParse(11.9).success).toBe(false);
    expect(focalLengthSchema.safeParse(200.1).success).toBe(false);
    expect(focalLengthSchema.safeParse(0).success).toBe(false);
  });

  it("rejects non-numeric and non-finite values", () => {
    expect(focalLengthSchema.safeParse("50").success).toBe(false);
    expect(focalLengthSchema.safeParse(Number.NaN).success).toBe(false);
    expect(focalLengthSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });
});

describe("aspectRatioSchema", () => {
  it("accepts exactly 9:16 and 16:9", () => {
    expect(aspectRatioSchema.safeParse("9:16").success).toBe(true);
    expect(aspectRatioSchema.safeParse("16:9").success).toBe(true);
    expect(aspectRatioSchema.safeParse("4:3").success).toBe(false);
    expect(aspectRatioSchema.safeParse(16).success).toBe(false);
  });
});

describe("cameraPoseSchema", () => {
  it("rejects unknown fields", () => {
    const result = cameraPoseSchema.safeParse({
      position: [0, 1.6, 3.4],
      target: [0, 1.55, 0],
      focalLengthMm: 35,
      rollDeg: 5,
    });
    expect(result.success).toBe(false);
  });
});

describe("charactersSchema", () => {
  it("accepts exactly one character_a and one character_b", () => {
    const result = charactersSchema.safeParse([
      { id: "character_b", position: [0.8, 0, 0], rotationYDeg: -90 },
      { id: "character_a", position: [-0.8, 0, 0], rotationYDeg: 90 },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects duplicate character_a entries (character_b missing)", () => {
    const result = charactersSchema.safeParse([
      { id: "character_a", position: [-0.8, 0, 0], rotationYDeg: 90 },
      { id: "character_a", position: [0.8, 0, 0], rotationYDeg: -90 },
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join("\n");
      expect(messages).toContain("character_a");
      expect(messages).toContain("character_b");
    }
  });

  it("rejects unknown character ids", () => {
    const result = charactersSchema.safeParse([
      { id: "character_a", position: [-0.8, 0, 0], rotationYDeg: 90 },
      { id: "character_c", position: [0.8, 0, 0], rotationYDeg: -90 },
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstIssuePath(result.error.issues)).toBe("/1/id");
    }
  });

  it("rejects rotation outside the Schema range", () => {
    const result = charactersSchema.safeParse([
      { id: "character_a", position: [-0.8, 0, 0], rotationYDeg: 361 },
      { id: "character_b", position: [0.8, 0, 0], rotationYDeg: -90 },
    ]);
    expect(result.success).toBe(false);
  });
});

describe("movementStateSchema", () => {
  it("rejects duration outside the Schema range", () => {
    const base = {
      type: "static",
      start: { position: [0, 1.6, 3.4], target: [0, 1.55, 0], focalLengthMm: 35 },
      end: { position: [0, 1.6, 3.4], target: [0, 1.55, 0], focalLengthMm: 35 },
      easing: "linear",
    } as const;
    expect(movementStateSchema.safeParse({ ...base, durationSeconds: 0.4 }).success).toBe(false);
    expect(movementStateSchema.safeParse({ ...base, durationSeconds: 20.5 }).success).toBe(false);
    expect(movementStateSchema.safeParse({ ...base, durationSeconds: 4 }).success).toBe(true);
  });

  it("rejects unknown movement types and easings", () => {
    const base = {
      start: { position: [0, 1.6, 3.4], target: [0, 1.55, 0], focalLengthMm: 35 },
      end: { position: [0, 1.6, 3.4], target: [0, 1.55, 0], focalLengthMm: 35 },
      durationSeconds: 4,
      easing: "linear",
    };
    expect(movementStateSchema.safeParse({ ...base, type: "crane_up" }).success).toBe(false);
    expect(
      movementStateSchema.safeParse({ ...base, type: "static", easing: "bouncy" }).success,
    ).toBe(false);
  });
});

describe("shotTemplateSchema", () => {
  it("accepts the minimal valid record", () => {
    const result = parseTemplate(minimalTemplateRecord());
    expect(result.success).toBe(true);
  });

  it("rejects unknown top-level fields", () => {
    const record = minimalTemplateRecord();
    record.unexpectedField = true;
    const result = parseTemplate(record);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("unexpectedField");
    }
  });

  it("rejects an invalid version", () => {
    expect(parseTemplate({ ...minimalTemplateRecord(), version: 0 }).success).toBe(false);
    expect(parseTemplate({ ...minimalTemplateRecord(), version: 1.5 }).success).toBe(false);
    expect(parseTemplate({ ...minimalTemplateRecord(), version: "1" }).success).toBe(false);
  });

  it("rejects an invalid reviewStatus including the archive's director_confirmed_execution", () => {
    expect(
      parseTemplate({ ...minimalTemplateRecord(), reviewStatus: "director_confirmed_execution" })
        .success,
    ).toBe(false);
    expect(parseTemplate({ ...minimalTemplateRecord(), reviewStatus: "unknown" }).success).toBe(
      false,
    );
  });

  it("rejects a malformed template id", () => {
    expect(parseTemplate({ ...minimalTemplateRecord(), id: "Bad-Id" }).success).toBe(false);
  });

  it("rejects duplicate directorRuleIds entries", () => {
    const record = minimalTemplateRecord();
    record.directorRuleIds = ["maintain_axis", "maintain_axis"];
    const result = parseTemplate(record);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("duplicate");
    }
  });

  it("rejects duplicate prompt-semantic entries", () => {
    const record = minimalTemplateRecord();
    const semantics = record.promptSemantics as Record<string, string[]>;
    semantics.optics = ["focal_35mm", "focal_35mm"];
    const result = parseTemplate(record);
    expect(result.success).toBe(false);
  });

  it("rejects an empty acceptance list", () => {
    const record = minimalTemplateRecord();
    record.acceptance = [];
    expect(parseTemplate(record).success).toBe(false);
  });

  it("rejects a malformed camera inside the full template with a field path", () => {
    const record = minimalTemplateRecord();
    record.camera = { ...(record.camera as object), focalLengthMm: 250 } as Record<string, unknown>;
    const result = parseTemplate(record);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstIssuePath(result.error.issues)).toBe("/camera/focalLengthMm");
    }
  });

  it("rejects a NaN vec3 inside movement.start with a field path", () => {
    const record = minimalTemplateRecord();
    const movement = record.movement as Record<string, unknown>;
    const start = movement.start as Record<string, unknown>;
    start.position = [Number.NaN, 1.6, 3.4];
    const result = parseTemplate(record);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstIssuePath(result.error.issues)).toBe("/movement/start/position/0");
    }
  });
});

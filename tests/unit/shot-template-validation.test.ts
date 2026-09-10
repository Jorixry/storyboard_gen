import { describe, expect, it } from "vitest";

import { loadRealTemplates, validateFixture } from "../helpers/content-test-utils";

/**
 * Content-pipeline validation tests: the three real YAML templates must stay
 * valid through the full schema.json (Ajv) + Zod + rule-reference pipeline,
 * and every negative fixture must be rejected with an actionable file +
 * field-path error. Fixtures live under tests/fixtures/content and never
 * touch the canonical content.
 */
describe("real repository content", () => {
  it("validates all three current YAML templates against schema.json, the Zod mirror and rule references", async () => {
    const templates = await loadRealTemplates();
    expect(templates.map((template) => template.id)).toEqual([
      "dialogue_medium_two_shot",
      "dialogue_ots_a_to_b",
      "dialogue_ots_b_to_a",
    ]);
  });

  it("keeps every current template at version 1 and engineering_ready (never approved)", async () => {
    const templates = await loadRealTemplates();
    for (const template of templates) {
      expect(template.version).toBe(1);
      expect(template.reviewStatus).toBe("engineering_ready");
    }
  });

  it("keeps both OTS templates at the director-ruled 75mm v2.1 CSV values", async () => {
    const templates = await loadRealTemplates();
    for (const id of ["dialogue_ots_a_to_b", "dialogue_ots_b_to_a"]) {
      const template = templates.find((candidate) => candidate.id === id);
      expect(template).toBeDefined();
      expect(template?.camera.focalLengthMm).toBe(75);
      expect(template?.movement.start.focalLengthMm).toBe(75);
      expect(template?.movement.end.focalLengthMm).toBe(75);
    }
  });
});

describe("negative fixtures are rejected with actionable errors", () => {
  it("valid_minimal passes the full pipeline", async () => {
    const issues = await validateFixture("valid_minimal.yaml");
    expect(issues).toEqual([]);
  });

  it("rejects a vec3 with the wrong length and points at /camera/position", async () => {
    const issues = await validateFixture("invalid_vec3_length.yaml");
    expect(issues.length).toBeGreaterThan(0);
    const issue = issues.find((candidate) => candidate.path.startsWith("/camera/position"));
    expect(issue).toBeDefined();
    expect(issue?.file).toBe("tests/fixtures/content/invalid_vec3_length.yaml");
    expect(issue?.message.length).toBeGreaterThan(0);
  });

  it("rejects a vec3 containing a string and points at the exact index", async () => {
    const issues = await validateFixture("invalid_vec3_string.yaml");
    const issue = issues.find((candidate) => candidate.path === "/camera/position/0");
    expect(issue).toBeDefined();
  });

  it("rejects a vec3 containing NaN (JSON Schema accepts it; the finite check must not)", async () => {
    const issues = await validateFixture("invalid_vec3_nan.yaml");
    expect(issues.length).toBeGreaterThan(0);
    const issue = issues.find((candidate) => candidate.path.startsWith("/camera/position"));
    expect(issue).toBeDefined();
  });

  it("rejects a vec3 containing Infinity", async () => {
    const issues = await validateFixture("invalid_vec3_infinity.yaml");
    expect(issues.length).toBeGreaterThan(0);
    const issue = issues.find((candidate) => candidate.path.startsWith("/camera/position"));
    expect(issue).toBeDefined();
  });

  it("rejects a focal length outside the Schema range", async () => {
    const issues = await validateFixture("invalid_focal_length.yaml");
    const issue = issues.find((candidate) => candidate.path === "/camera/focalLengthMm");
    expect(issue).toBeDefined();
  });

  it("rejects duplicate character_a entries (character_b missing)", async () => {
    const issues = await validateFixture("invalid_duplicate_characters.yaml");
    expect(issues.length).toBeGreaterThan(0);
    const messages = issues.map((issue) => issue.message).join("\n");
    expect(messages).toContain("character_a");
    expect(messages).toContain("character_b");
  });

  it("rejects a single-character template (missing character_b)", async () => {
    const issues = await validateFixture("invalid_single_character.yaml");
    const issue = issues.find((candidate) => candidate.path === "/characters");
    expect(issue).toBeDefined();
  });

  it("rejects an unknown character id", async () => {
    const issues = await validateFixture("invalid_unknown_character_id.yaml");
    const issue = issues.find((candidate) => candidate.path === "/characters/1/id");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("character_a");
    expect(issue?.message).toContain("character_b");
  });

  it("rejects an unknown rule id that does not exist in content/rules/", async () => {
    const issues = await validateFixture("invalid_unknown_rule_id.yaml");
    const issue = issues.find((candidate) => candidate.path === "/directorRuleIds");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("nonexistent_rule");
    expect(issue?.message).toContain("content/rules/");
  });

  it("rejects duplicate rule ids", async () => {
    const issues = await validateFixture("invalid_duplicate_rule_id.yaml");
    const issue = issues.find((candidate) => candidate.path === "/directorRuleIds");
    expect(issue).toBeDefined();
    expect(issue?.message.toLowerCase()).toContain("duplicate");
  });

  it("rejects unknown top-level fields", async () => {
    const issues = await validateFixture("invalid_unknown_field.yaml");
    const issue = issues.find((candidate) => candidate.message.includes("unknownTopLevelField"));
    expect(issue).toBeDefined();
  });

  it("rejects the archive-style reviewStatus director_confirmed_execution", async () => {
    const issues = await validateFixture("invalid_review_status.yaml");
    const issue = issues.find((candidate) => candidate.path === "/reviewStatus");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("director_confirmed_execution");
  });

  it("rejects an unsupported aspect ratio", async () => {
    const issues = await validateFixture("invalid_aspect_ratio.yaml");
    const issue = issues.find((candidate) => candidate.path === "/scene/aspectRatio");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("4:3");
  });

  it("rejects version 0", async () => {
    const issues = await validateFixture("invalid_version.yaml");
    const issue = issues.find((candidate) => candidate.path === "/version");
    expect(issue).toBeDefined();
  });

  it("rejects broken YAML syntax with a file-level error", async () => {
    const issues = await validateFixture("invalid_yaml_syntax.yaml");
    expect(issues.length).toBeGreaterThan(0);
    const issue = issues[0];
    expect(issue.file).toBe("tests/fixtures/content/invalid_yaml_syntax.yaml");
    expect(issue.path).toBe("");
    expect(issue.message).toContain("YAML parse error");
  });

  it("reports every issue with a file, a field path and a non-empty reason", async () => {
    const allFixtures = [
      "invalid_vec3_length.yaml",
      "invalid_vec3_string.yaml",
      "invalid_vec3_nan.yaml",
      "invalid_vec3_infinity.yaml",
      "invalid_focal_length.yaml",
      "invalid_duplicate_characters.yaml",
      "invalid_single_character.yaml",
      "invalid_unknown_character_id.yaml",
      "invalid_unknown_rule_id.yaml",
      "invalid_duplicate_rule_id.yaml",
      "invalid_unknown_field.yaml",
      "invalid_review_status.yaml",
      "invalid_aspect_ratio.yaml",
      "invalid_version.yaml",
    ];
    for (const fixture of allFixtures) {
      const issues = await validateFixture(fixture);
      expect(issues.length, fixture).toBeGreaterThan(0);
      for (const issue of issues) {
        expect(issue.file, fixture).toContain(fixture);
        expect(typeof issue.path, fixture).toBe("string");
        expect(issue.message.length, fixture).toBeGreaterThan(0);
      }
    }
  });
});

describe("content validation safety", () => {
  it("performs no network requests", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      throw new Error("content validation must not perform network requests");
    }) as typeof fetch;
    try {
      await loadRealTemplates();
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

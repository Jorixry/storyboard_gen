import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  validateAdapterConfigFile,
  validateAdapterConfigs,
  validateContent,
} from "../../scripts/lib/content-validation";
import { projectRoot, realContentDir } from "../helpers/content-test-utils";

/**
 * Adapter-content pipeline (Prompt 6): content/adapters/*.yaml is validated by
 * the same gate as templates, so generic-video.yaml cannot drift silently —
 * invalid ordering/constraints/ids refuse validate:content (and therefore
 * compile:content and build).
 */

const adaptersFixtureDir = path.join(projectRoot, "tests", "fixtures", "adapters");

const VALID_CONFIG = `id: generic_video
version: 1
status: engineering_placeholder
descriptionZh: valid duplicate-id probe file
ordering:
  - subjects
  - composition
  - optics
  - motion
  - continuity
constraints:
  preserveStructuredFacts: true
  allowLlmPolish: true
  llmMayChange:
    - wording
  llmMayNotChange:
    - camera_geometry
`;

describe("adapter content validation against the real repository content", () => {
  it("validates generic-video.yaml and returns its typed config", async () => {
    const { adapterConfigs, issues, fileCount } = await validateAdapterConfigs(
      path.join(realContentDir, "adapters"),
      realContentDir,
    );
    expect(issues).toEqual([]);
    expect(fileCount).toBe(1);
    expect(adapterConfigs).toHaveLength(1);
    expect(adapterConfigs[0]).toMatchObject({
      id: "generic_video",
      version: 1,
      status: "engineering_placeholder",
      ordering: ["subjects", "composition", "optics", "motion", "continuity"],
      constraints: {
        preserveStructuredFacts: true,
        allowLlmPolish: true,
        llmMayChange: ["wording", "grammar"],
        llmMayNotChange: [
          "character_identity",
          "character_position",
          "camera_geometry",
          "focal_length",
          "movement_type",
          "continuity_rules",
        ],
      },
    });
  });

  it("surfaced through validateContent with counts and zero issues", async () => {
    const result = await validateContent(realContentDir);
    expect(result.issues).toEqual([]);
    expect(result.adapterConfigFileCount).toBe(1);
    expect(result.adapterConfigs.map((config) => config.id)).toEqual(["generic_video"]);
  });
});

describe("adapter content validation rejects invalid fixture files", () => {
  it.each([
    [
      "invalid_ordering_duplicate.yaml",
      /ordering must contain each semantic category exactly once/,
    ],
    ["invalid_unknown_field.yaml", /unexpectedTopLevel/],
    ["invalid_preserve_false.yaml", /preserve structured facts/],
    ["invalid_version_type.yaml", /expected number, received string/],
  ])("rejects %s", async (fileName, expectedMessage) => {
    const { issues, config } = await validateAdapterConfigFile(
      path.join(adaptersFixtureDir, fileName),
      `tests/fixtures/adapters/${fileName}`,
    );
    expect(config).toBeNull();
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((issue) => issue.message).join("\n")).toMatch(expectedMessage);
  });

  it("flags duplicate adapter ids across files in one directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "storyboard-adapters-"));
    try {
      await writeFile(path.join(dir, "a.yaml"), VALID_CONFIG, "utf8");
      await writeFile(path.join(dir, "b.yaml"), VALID_CONFIG, "utf8");
      const { adapterConfigs, issues, fileCount } = await validateAdapterConfigs(dir, dir);
      expect(fileCount).toBe(2);
      expect(adapterConfigs).toHaveLength(1); // the first valid definition survives
      expect(issues.map((issue) => issue.message).join("\n")).toMatch(
        /duplicate adapter config id "generic_video"/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

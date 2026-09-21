import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileContentToSource } from "../../scripts/lib/content-validation";
import { loadRealContent } from "../helpers/content-test-utils";

describe("compileContentToSource determinism", () => {
  it("produces identical output for two consecutive compilations of the same input", async () => {
    const { templates, adapterConfigs } = await loadRealContent();
    const first = compileContentToSource(templates, adapterConfigs);
    const second = compileContentToSource(templates, adapterConfigs);
    expect(first).toBe(second);
    const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
    expect(hash(first)).toBe(hash(second));
  });

  it("sorts both exports by id, independent of filesystem enumeration order", async () => {
    const { templates, adapterConfigs } = await loadRealContent();
    const sortedInput = compileContentToSource(templates, adapterConfigs);
    const shuffledInput = compileContentToSource(
      [...templates].reverse(),
      [...adapterConfigs].reverse(),
    );
    expect(shuffledInput).toBe(sortedInput);

    const firstIdIndex = sortedInput.indexOf('"dialogue_medium_two_shot"');
    const lastIdIndex = sortedInput.indexOf('"dialogue_ots_b_to_a"');
    expect(firstIdIndex).toBeGreaterThan(-1);
    expect(lastIdIndex).toBeGreaterThan(firstIdIndex);
  });

  it("embeds no timestamps, random values or machine absolute paths", async () => {
    const { templates, adapterConfigs } = await loadRealContent();
    const source = compileContentToSource(templates, adapterConfigs);
    expect(source).not.toContain(path.resolve(process.cwd()));
    expect(source).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(source).toContain("// GENERATED FILE - DO NOT EDIT.");
    expect(source).toContain("npm run compile:content");
  });

  it("writes byte-identical files on consecutive compilations to a safe temp directory", async () => {
    const { templates, adapterConfigs } = await loadRealContent();
    const dir = await mkdtemp(path.join(tmpdir(), "storyboard-compile-"));
    try {
      const firstPath = path.join(dir, "first.ts");
      const secondPath = path.join(dir, "second.ts");
      await writeFile(firstPath, compileContentToSource(templates, adapterConfigs), "utf8");
      await writeFile(secondPath, compileContentToSource(templates, adapterConfigs), "utf8");
      const firstBytes = await readFile(firstPath);
      const secondBytes = await readFile(secondPath);
      expect(firstBytes.equals(secondBytes)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("contains the typed exports for all validated templates and adapter configs", async () => {
    const { templates, adapterConfigs } = await loadRealContent();
    const source = compileContentToSource(templates, adapterConfigs);
    expect(source).toContain("export const COMPILED_SHOT_TEMPLATES: readonly ShotTemplate[]");
    expect(source).toContain(
      "export const COMPILED_ADAPTER_CONFIGS: readonly VideoPromptAdapterConfig[]",
    );
    for (const template of templates) {
      expect(source).toContain(`"id": "${template.id}"`);
      expect(source).toContain(`"version": ${template.version}`);
      expect(source).toContain(`"reviewStatus": "${template.reviewStatus}"`);
    }
    for (const config of adapterConfigs) {
      expect(source).toContain(`"id": "${config.id}"`);
      expect(source).toContain(`"version": ${config.version}`);
      expect(source).toContain(`"status": "${config.status}"`);
    }
  });

  it("keeps template and adapter-config records unchanged by compilation", async () => {
    const { templates, adapterConfigs } = await loadRealContent();
    const source = compileContentToSource(templates, adapterConfigs);

    const templatesStart = source.indexOf("COMPILED_SHOT_TEMPLATES: readonly ShotTemplate[] = ");
    const templatesEnd = source.indexOf(";\n\nexport const COMPILED_ADAPTER_CONFIGS");
    const reparsedTemplates = JSON.parse(
      source.slice(
        source.indexOf("= [", templatesStart) + 2,
        source.lastIndexOf("];", templatesEnd) + 1,
      ),
    ) as typeof templates;
    expect(reparsedTemplates).toEqual(templates);

    const adaptersStart = source.indexOf(
      "COMPILED_ADAPTER_CONFIGS: readonly VideoPromptAdapterConfig[] = ",
    );
    const adaptersEnd = source.lastIndexOf("];");
    const reparsedAdapters = JSON.parse(
      source.slice(source.indexOf("= [", adaptersStart) + 2, adaptersEnd + 1),
    ) as typeof adapterConfigs;
    expect(reparsedAdapters).toEqual(adapterConfigs);
  });
});

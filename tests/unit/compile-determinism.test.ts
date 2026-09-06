import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileTemplatesToSource } from "../../scripts/lib/content-validation";
import { loadRealTemplates } from "../helpers/content-test-utils";

describe("compileTemplatesToSource determinism", () => {
  it("produces identical output for two consecutive compilations of the same input", async () => {
    const templates = await loadRealTemplates();
    const first = compileTemplatesToSource(templates);
    const second = compileTemplatesToSource(templates);
    expect(first).toBe(second);
    const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
    expect(hash(first)).toBe(hash(second));
  });

  it("sorts by template id, independent of filesystem enumeration order", async () => {
    const templates = await loadRealTemplates();
    const sortedInput = compileTemplatesToSource(templates);
    const shuffledInput = compileTemplatesToSource([...templates].reverse());
    expect(shuffledInput).toBe(sortedInput);

    const firstIdIndex = sortedInput.indexOf('"dialogue_medium_two_shot"');
    const lastIdIndex = sortedInput.indexOf('"dialogue_ots_b_to_a"');
    expect(firstIdIndex).toBeGreaterThan(-1);
    expect(lastIdIndex).toBeGreaterThan(firstIdIndex);
  });

  it("embeds no timestamps, random values or machine absolute paths", async () => {
    const templates = await loadRealTemplates();
    const source = compileTemplatesToSource(templates);
    expect(source).not.toContain(path.resolve(process.cwd()));
    expect(source).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(source).toContain("// GENERATED FILE - DO NOT EDIT.");
    expect(source).toContain("npm run compile:content");
  });

  it("writes byte-identical files on consecutive compilations to a safe temp directory", async () => {
    const templates = await loadRealTemplates();
    const dir = await mkdtemp(path.join(tmpdir(), "storyboard-compile-"));
    try {
      const firstPath = path.join(dir, "first.ts");
      const secondPath = path.join(dir, "second.ts");
      await writeFile(firstPath, compileTemplatesToSource(templates), "utf8");
      await writeFile(secondPath, compileTemplatesToSource(templates), "utf8");
      const firstBytes = await readFile(firstPath);
      const secondBytes = await readFile(secondPath);
      expect(firstBytes.equals(secondBytes)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("contains the typed export for all three validated templates", async () => {
    const templates = await loadRealTemplates();
    const source = compileTemplatesToSource(templates);
    expect(source).toContain("export const COMPILED_SHOT_TEMPLATES: readonly ShotTemplate[]");
    for (const template of templates) {
      expect(source).toContain(`"id": "${template.id}"`);
      expect(source).toContain(`"version": ${template.version}`);
      expect(source).toContain(`"reviewStatus": "${template.reviewStatus}"`);
    }
  });

  it("keeps template id, version and reviewStatus unchanged by compilation", async () => {
    const templates = await loadRealTemplates();
    const source = compileTemplatesToSource(templates);
    const start = source.indexOf("= [") + 2;
    const end = source.lastIndexOf("];");
    const reparsed = JSON.parse(source.slice(start, end + 1)) as typeof templates;
    expect(reparsed).toEqual(templates);
  });
});

/**
 * Shared helpers for content-pipeline tests: loads the real repository
 * content and validates fixture files through the same pipeline the CLI
 * scripts use. Deterministic, local-only, no network access.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ValidateFunction } from "ajv/dist/2020";

import type { ContentIssue } from "../../src/domain/errors";
import type { ShotTemplate } from "../../src/domain/shot-template";
import {
  loadRuleUniverse,
  loadShotTemplateSchema,
  validateContent,
  validateTemplateFile,
} from "../../scripts/lib/content-validation";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const realContentDir = path.join(projectRoot, "content");
export const fixtureContentDir = path.join(projectRoot, "tests", "fixtures", "content");

/** Validates the real repository content and fails the test if it is invalid. */
export async function loadRealTemplates(): Promise<ShotTemplate[]> {
  const { templates, issues } = await validateContent(realContentDir);
  if (issues.length > 0) {
    throw new Error(
      `real content failed validation:\n${issues.map((issue) => `${issue.file}${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
  return templates;
}

let cachedContext: { validator: ValidateFunction; ruleIds: Set<string> } | undefined;

/** Schema validator + rule universe from the real content, cached per worker. */
export async function realValidationContext(): Promise<{
  validator: ValidateFunction;
  ruleIds: Set<string>;
}> {
  if (cachedContext === undefined) {
    const validator = await loadShotTemplateSchema(realContentDir);
    const { ruleIds } = await loadRuleUniverse(path.join(realContentDir, "rules"));
    cachedContext = { validator, ruleIds };
  }
  return cachedContext;
}

/** Runs the full read -> parse -> validate pipeline on one fixture file. */
export async function validateFixture(fileName: string): Promise<ContentIssue[]> {
  const context = await realValidationContext();
  const file = path.join(fixtureContentDir, fileName);
  const relativePath = `tests/fixtures/content/${fileName}`;
  const { issues } = await validateTemplateFile(file, relativePath, context);
  return issues;
}

/** Reads a fixture template that must be fully valid. */
export async function loadValidFixture(fileName: string): Promise<ShotTemplate> {
  const context = await realValidationContext();
  const file = path.join(fixtureContentDir, fileName);
  const { issues, template } = await validateTemplateFile(
    file,
    `tests/fixtures/content/${fileName}`,
    context,
  );
  if (template === null) {
    throw new Error(`fixture ${fileName} is not valid:\n${JSON.stringify(issues, null, 2)}`);
  }
  return template;
}

export async function readFixtureText(fileName: string): Promise<string> {
  return readFile(path.join(fixtureContentDir, fileName), "utf8");
}

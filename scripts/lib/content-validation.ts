/**
 * Build-time content validation and compilation core.
 *
 * Authority chain (see AGENTS.md / PROJECT_STRUCTURE.md):
 * - content/schema/shot-template.schema.json is the authoritative strict
 *   content Schema; it is loaded from disk and enforced with Ajv
 *   (draft 2020-12, additionalProperties: false rejects unknown fields).
 * - The Zod domain schema in src/domain/ is the typed mirror of the same
 *   contract; both validators run and any divergence is reported, never
 *   silently resolved.
 * - content/rules/ supplies the universe of referencable rule IDs.
 *
 * This module is build/test tooling: it may import Node-only APIs and lives
 * under scripts/, never inside src/ runtime code.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import { parse as parseYaml } from "yaml";

import { formatZodPath, type ContentIssue } from "../../src/domain/errors";
import { shotTemplateSchema, type ShotTemplate } from "../../src/domain/shot-template";
import {
  videoPromptAdapterConfigSchema,
  type VideoPromptAdapterConfig,
} from "../../src/domain/video-adapter-config";

export interface ContentValidationResult {
  /** Templates from files with zero issues, sorted by id. */
  templates: ShotTemplate[];
  /** Adapter-content configs (content/adapters/) with zero issues, sorted by id. */
  adapterConfigs: VideoPromptAdapterConfig[];
  /** Every issue found, in deterministic file/path order. */
  issues: ContentIssue[];
  /** Number of template YAML files that were checked. */
  templateFileCount: number;
  /** Number of adapter-content YAML files that were checked. */
  adapterConfigFileCount: number;
}

const TEMPLATE_YAML_GLOB_DIR = "templates";
const ADAPTER_YAML_GLOB_DIR = "adapters";

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

/** Recursively collects .yaml/.yml files under dir, returned sorted by relative path. */
export async function collectYamlFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(yaml|yml)$/.test(entry.name)) {
        files.push(full);
      }
    }
  }
  await walk(dir);
  return files.sort((a, b) =>
    toPosix(path.relative(dir, a)).localeCompare(toPosix(path.relative(dir, b))),
  );
}

export async function loadShotTemplateSchema(contentDir: string): Promise<ValidateFunction> {
  const schemaPath = path.join(contentDir, "schema", "shot-template.schema.json");
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true, verbose: true });
  return ajv.compile(schema);
}

export interface RuleUniverse {
  ruleIds: Set<string>;
  issues: ContentIssue[];
}

/** Loads rule IDs from content/rules/*.yaml. Only IDs are extracted; rule prose is not compiled. */
export async function loadRuleUniverse(rulesDir: string): Promise<RuleUniverse> {
  const issues: ContentIssue[] = [];
  const ruleIds = new Set<string>();
  const files = await collectYamlFiles(rulesDir);
  for (const file of files) {
    const relativePath = toPosix(path.relative(path.dirname(rulesDir), file));
    let parsed: unknown;
    try {
      parsed = parseYaml(await readFile(file, "utf8"));
    } catch (error) {
      issues.push({
        file: relativePath,
        path: "",
        message: `YAML parse error: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    const rules = (parsed as { rules?: unknown } | null)?.rules;
    if (!Array.isArray(rules)) {
      issues.push({
        file: relativePath,
        path: "/rules",
        message: 'rules file must contain a "rules" array',
      });
      continue;
    }
    rules.forEach((rule, index) => {
      const id = (rule as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || id.length === 0) {
        issues.push({
          file: relativePath,
          path: `/rules/${index}/id`,
          message: "rule entry must have a non-empty string id",
        });
        return;
      }
      if (ruleIds.has(id)) {
        issues.push({
          file: relativePath,
          path: `/rules/${index}/id`,
          message: `duplicate rule id "${id}" across content/rules/`,
        });
        return;
      }
      ruleIds.add(id);
    });
  }
  return { ruleIds, issues };
}

function describeAjvError(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case "additionalProperties":
      return `unexpected property "${String(params.additionalProperty)}" (unknown fields are rejected)`;
    case "enum":
      return `must be one of: ${(params.allowedValues as unknown[]).map((v) => JSON.stringify(v)).join(", ")} (received ${JSON.stringify(error.data)})`;
    case "const":
      return `must be ${JSON.stringify(params.allowedValue)}`;
    case "required":
      return `missing required property "${String(params.missingProperty)}"`;
    case "type":
      return `must be of type ${String(params.type)}`;
    case "uniqueItems":
      return "must not contain duplicate items";
    case "pattern":
      return `must match pattern ${String(params.pattern)}`;
    default:
      return error.message ?? "invalid value";
  }
}

function ajvIssues(relativePath: string, errors: ErrorObject[]): ContentIssue[] {
  return errors.map((error) => ({
    file: relativePath,
    path: error.instancePath,
    message: describeAjvError(error),
  }));
}

function zodIssues(
  relativePath: string,
  error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> },
): ContentIssue[] {
  return error.issues.map((issue) => ({
    file: relativePath,
    path: formatZodPath(issue.path.map((segment) => String(segment))),
    message: issue.message,
  }));
}

function ruleReferenceIssues(
  template: ShotTemplate,
  ruleIds: Set<string>,
  relativePath: string,
): ContentIssue[] {
  const unknown = template.directorRuleIds.filter((ruleId) => !ruleIds.has(ruleId));
  if (unknown.length === 0) {
    return [];
  }
  return unknown.map((ruleId) => ({
    file: relativePath,
    path: "/directorRuleIds",
    message: `unknown rule id "${ruleId}"; it does not exist in content/rules/`,
  }));
}

/**
 * Validates one parsed template record against the JSON Schema, the Zod
 * domain mirror and the rule universe. Returns every issue plus the typed
 * template when it is fully valid.
 */
export function validateTemplateRecord(
  record: unknown,
  context: { file: string; validator: ValidateFunction; ruleIds: Set<string> },
): { issues: ContentIssue[]; template: ShotTemplate | null } {
  const { file, validator, ruleIds } = context;
  if (!validator(record)) {
    return { issues: ajvIssues(file, validator.errors ?? []), template: null };
  }
  const zodResult = shotTemplateSchema.safeParse(record);
  if (!zodResult.success) {
    return { issues: zodIssues(file, zodResult.error), template: null };
  }
  const issues = ruleReferenceIssues(zodResult.data, ruleIds, file);
  return { issues, template: issues.length === 0 ? zodResult.data : null };
}

/**
 * Reads, parses and validates one template YAML file. YAML parse failures
 * are reported as a file-level issue instead of being thrown.
 */
export async function validateTemplateFile(
  file: string,
  relativePath: string,
  context: { validator: ValidateFunction; ruleIds: Set<string> },
): Promise<{ issues: ContentIssue[]; template: ShotTemplate | null }> {
  let parsed: unknown;
  try {
    parsed = parseYaml(await readFile(file, "utf8"));
  } catch (error) {
    return {
      issues: [
        {
          file: relativePath,
          path: "",
          message: `YAML parse error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      template: null,
    };
  }
  return validateTemplateRecord(parsed, { file: relativePath, ...context });
}

/**
 * Reads, parses and validates one adapter-content YAML file
 * (content/adapters/*.yaml) against the Zod contract in
 * src/domain/video-adapter-config.ts. YAML parse failures are reported as a
 * file-level issue instead of being thrown.
 */
export async function validateAdapterConfigFile(
  file: string,
  relativePath: string,
): Promise<{ issues: ContentIssue[]; config: VideoPromptAdapterConfig | null }> {
  let parsed: unknown;
  try {
    parsed = parseYaml(await readFile(file, "utf8"));
  } catch (error) {
    return {
      issues: [
        {
          file: relativePath,
          path: "",
          message: `YAML parse error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      config: null,
    };
  }
  const result = videoPromptAdapterConfigSchema.safeParse(parsed);
  if (!result.success) {
    return { issues: zodIssues(relativePath, result.error), config: null };
  }
  return { issues: [], config: result.data };
}

/**
 * Validates every adapter-content YAML under one adapters/ directory:
 * schema check per file plus cross-file adapter-id uniqueness.
 * `pathRelativeTo` is the base for reported relative file paths.
 */
export async function validateAdapterConfigs(
  adaptersDir: string,
  pathRelativeTo: string,
): Promise<{
  adapterConfigs: VideoPromptAdapterConfig[];
  issues: ContentIssue[];
  fileCount: number;
}> {
  const issues: ContentIssue[] = [];
  const files = await collectYamlFiles(adaptersDir);
  const adapterConfigs: VideoPromptAdapterConfig[] = [];
  const seenAdapterIds = new Map<string, string>();
  for (const file of files) {
    const relativePath = toPosix(path.relative(pathRelativeTo, file));
    const result = await validateAdapterConfigFile(file, relativePath);
    issues.push(...result.issues);
    if (result.config === null) {
      continue;
    }
    const config = result.config;
    const firstSeenIn = seenAdapterIds.get(config.id);
    if (firstSeenIn === undefined) {
      seenAdapterIds.set(config.id, relativePath);
      adapterConfigs.push(config);
    } else {
      issues.push({
        file: relativePath,
        path: "/id",
        message: `duplicate adapter config id "${config.id}"; already defined in ${firstSeenIn}`,
      });
    }
  }
  adapterConfigs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { adapterConfigs, issues, fileCount: files.length };
}

/**
 * Full content validation pass over contentDir: every template YAML file
 * under templates/ is checked against schema.json + the Zod domain mirror +
 * rule references, plus cross-file template-id uniqueness; every adapter
 * config YAML under adapters/ is checked against its Zod contract plus
 * cross-file adapter-id uniqueness.
 */
export async function validateContent(contentDir: string): Promise<ContentValidationResult> {
  const issues: ContentIssue[] = [];
  const validator = await loadShotTemplateSchema(contentDir);
  const { ruleIds, issues: ruleIssues } = await loadRuleUniverse(path.join(contentDir, "rules"));
  issues.push(...ruleIssues);

  const templatesDir = path.join(contentDir, TEMPLATE_YAML_GLOB_DIR);
  const files = await collectYamlFiles(templatesDir);
  const templates: ShotTemplate[] = [];
  const seenTemplateIds = new Map<string, string>();

  for (const file of files) {
    const relativePath = toPosix(path.relative(contentDir, file));
    const result = await validateTemplateFile(file, relativePath, { validator, ruleIds });
    issues.push(...result.issues);
    if (result.template === null) {
      continue;
    }
    const template = result.template;
    const firstSeenIn = seenTemplateIds.get(template.id);
    if (firstSeenIn === undefined) {
      seenTemplateIds.set(template.id, relativePath);
      templates.push(template);
    } else {
      issues.push({
        file: relativePath,
        path: "/id",
        message: `duplicate template id "${template.id}"; already defined in ${firstSeenIn}`,
      });
    }
  }

  const adapterResult = await validateAdapterConfigs(
    path.join(contentDir, ADAPTER_YAML_GLOB_DIR),
    contentDir,
  );
  issues.push(...adapterResult.issues);

  templates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    templates,
    adapterConfigs: adapterResult.adapterConfigs,
    issues,
    templateFileCount: files.length,
    adapterConfigFileCount: adapterResult.fileCount,
  };
}

/** Output path of the generated compiled-content module. */
export function compiledContentPath(projectRoot: string): string {
  return path.join(projectRoot, "src", "content", "compiled-content.ts");
}

const COMPILED_HEADER = [
  "// GENERATED FILE - DO NOT EDIT.",
  "// Regenerate with: npm run compile:content",
  "// Source of truth: the YAML templates under content/templates/, validated",
  "// against content/schema/shot-template.schema.json. Sorting and formatting",
  "// are deterministic: identical inputs always produce identical bytes.",
  "",
  'import type { ShotTemplate } from "../domain/shot-template";',
  "",
  "",
].join("\n");

/**
 * Renders validated templates as a deterministic TypeScript module.
 * Templates are sorted by id, so the output never depends on filesystem
 * enumeration order, timestamps or absolute paths.
 */
export function compileTemplatesToSource(templates: readonly ShotTemplate[]): string {
  const sorted = [...templates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return `${COMPILED_HEADER}export const COMPILED_SHOT_TEMPLATES: readonly ShotTemplate[] = ${JSON.stringify(
    sorted,
    null,
    2,
  )};\n`;
}

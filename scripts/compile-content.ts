/**
 * Deterministic content compilation entry point (Prompt 2 / Phase 1 Day 2).
 *
 * Runs the same strict validation as validate:content first; only fully
 * valid templates are compiled. Output is the typed application data module
 * src/content/compiled-content.ts (git-ignored, never hand-edited):
 * sorted by template id, no timestamps, no random IDs, no machine absolute
 * paths. Two consecutive compilations of the same input produce identical
 * bytes; the printed SHA-256 makes that checkable.
 *
 * Pipeline relationship: validate -> compile -> build (build invokes this
 * script first, so a fresh checkout never depends on a pre-existing ignored
 * generated file).
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { formatIssue } from "../src/domain/errors";
import {
  compiledContentPath,
  compileTemplatesToSource,
  validateContent,
} from "./lib/content-validation";

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const contentDir = path.resolve(projectRoot, "content");
  const { templates, issues, templateFileCount } = await validateContent(contentDir);

  if (issues.length > 0) {
    console.error(
      `[compile-content] REFUSED: ${issues.length} validation issue(s); nothing was compiled:`,
    );
    for (const issue of issues) {
      console.error(`  ${formatIssue(issue)}`);
    }
    process.exit(1);
  }

  const source = compileTemplatesToSource(templates);
  const target = compiledContentPath(projectRoot);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source, "utf8");

  const sha256 = createHash("sha256").update(source, "utf8").digest("hex");
  console.log(
    `[compile-content] compiled ${templates.length} of ${templateFileCount} template file(s) to ${path.relative(
      projectRoot,
      target,
    )}`,
  );
  console.log(`[compile-content] sha256=${sha256}`);
  for (const template of templates) {
    console.log(`  ${template.id} v${template.version} [${template.reviewStatus}]`);
  }
}

main().catch((error) => {
  console.error("[compile-content] unexpected failure:", error);
  process.exit(1);
});

/**
 * Strict content validation entry point (Prompt 2 / Phase 1 Day 2).
 *
 * Validates every template YAML file under content/templates/ against
 * content/schema/shot-template.schema.json (Ajv, draft 2020-12, unknown
 * fields rejected), the equivalent Zod domain schema and the rule universe
 * in content/rules/. Exits non-zero when any file fails; errors are reported
 * with file, field path and reason, never downgraded or swallowed.
 *
 * Pipeline relationship: validate:content is the gate for compile:content,
 * and build runs compile:content first, so a build cannot proceed from
 * invalid content.
 */

import path from "node:path";

import { formatIssue } from "../src/domain/errors";
import { validateContent } from "./lib/content-validation";

async function main(): Promise<void> {
  const contentDir = path.resolve(process.cwd(), "content");
  console.log(
    `[validate-content] validating templates in ${path.relative(process.cwd(), contentDir)}`,
  );
  const { templates, issues, templateFileCount } = await validateContent(contentDir);

  if (issues.length > 0) {
    console.error(`[validate-content] FAILED: ${issues.length} issue(s) found:`);
    for (const issue of issues) {
      console.error(`  ${formatIssue(issue)}`);
    }
    process.exit(1);
  }

  console.log(
    `[validate-content] OK: ${templateFileCount} template file(s) valid, ${templates.length} template(s) passed.`,
  );
  for (const template of templates) {
    console.log(`  ${template.id} v${template.version} [${template.reviewStatus}]`);
  }
}

main().catch((error) => {
  console.error("[validate-content] unexpected failure:", error);
  process.exit(1);
});

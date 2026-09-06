/**
 * Placeholder content-validation entry point (Prompt 1 / Phase 1 Day 1).
 *
 * This is NOT the content Schema compiler. The full YAML validation against
 * content/schema/shot-template.schema.json is implemented in Prompt 2
 * (Phase 1 Day 2). This command only proves the wiring exists and reports
 * which content files are present so the later compiler has a stable entry.
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const CONTENT_DIR = path.resolve(process.cwd(), "content");

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else {
      files.push(path.relative(CONTENT_DIR, full));
    }
  }
  return files;
}

async function main(): Promise<void> {
  console.log("[validate-content] PLACEHOLDER - full schema validation arrives in Prompt 2.");
  let contentDirStat;
  try {
    contentDirStat = await stat(CONTENT_DIR);
  } catch {
    console.error(`[validate-content] content directory not found: ${CONTENT_DIR}`);
    process.exit(1);
  }
  if (!contentDirStat.isDirectory()) {
    console.error(`[validate-content] not a directory: ${CONTENT_DIR}`);
    process.exit(1);
  }
  const files = (await collectFiles(CONTENT_DIR)).sort();
  console.log(`[validate-content] ${files.length} content files present:`);
  for (const file of files) {
    console.log(`  ${file}`);
  }
}

main().catch((error) => {
  console.error("[validate-content] unexpected failure:", error);
  process.exit(1);
});

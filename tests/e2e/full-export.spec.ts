import { expect, test, type Download, type Page } from "@playwright/test";

import { fullExportManifestSchema, sha256Hex } from "../../src/domain/artifacts";
import { shotStateSchema } from "../../src/domain/shot-state";
import { GenericVideoPromptAdapter } from "../../src/adapters/video-prompts/generic";
import { SeedanceVideoPromptAdapter } from "../../src/adapters/video-prompts/seedance";
import { compileVideoPrompt } from "../../src/features/prompt-compiler/compile";
import { readStoreZip } from "../helpers/zip-reader";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";

/**
 * Full input-package browser evidence (Prompt 8 / Phase 2 §2.3 + Phase 3
 * Day 9). Every test downloads the REAL archive and verifies it in Node with
 * production-independent tooling: the strict v2 manifest schema, an
 * independent CRC-checked ZIP reader, full SHA-256 verification, and BOTH
 * prompts re-compiled from the shipped shot-state.json through the real
 * adapters — proving same-source coherence, not just "files exist". The
 * enhanced frame rides the deterministic mock; zero external requests, zero
 * cost. Phase 3 surfaces (onboarding copy, safe-range warnings) are covered
 * by the first and last tests.
 *
 * Note: no imports from tests/helpers/content-test-utils here — it uses
 * import.meta, which Playwright's CJS transform of specs cannot load.
 */

const projectRoot = process.cwd();
const EVIDENCE_DIR = path.join("tmp", "prompt8-evidence");

interface ExportedState {
  id: string;
  template: { id: string; version: number; reviewStatus: string };
}

/** Loads the real adapter configs through the same pipeline the CLI uses. */
async function loadAdapterConfigs() {
  const { validateContent } = await import("../../scripts/lib/content-validation");
  const { adapterConfigs, issues } = await validateContent(path.join(projectRoot, "content"));
  if (issues.length > 0) {
    throw new Error(`real content failed validation: ${JSON.stringify(issues)}`);
  }
  return adapterConfigs;
}

async function selectFirstTemplate(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("studio-root")).toBeVisible();
  await page.getByTestId("select-template-dialogue_medium_two_shot").click();
  await expect(page.getByTestId("studio-workspace")).toBeVisible();
}

async function beginFullExport(page: Page): Promise<Download> {
  const download = page.waitForEvent("download");
  await page.getByTestId("export-full-zip").click();
  return download;
}

async function readFullExport(
  download: Promise<Download> | Download,
  evidenceFile: string,
): Promise<{
  entries: Map<string, Buffer>;
  manifest: ReturnType<typeof fullExportManifestSchema.parse>;
  state: ExportedState;
}> {
  const resolved = await download;
  const evidenceRoot = path.resolve(projectRoot, EVIDENCE_DIR);
  const evidencePath = path.resolve(evidenceRoot, evidenceFile);
  if (
    path.basename(evidenceFile) !== evidenceFile ||
    !evidencePath.startsWith(evidenceRoot + path.sep)
  ) {
    throw new Error(`unsafe evidence name: ${evidenceFile}`);
  }
  await mkdir(evidenceRoot, { recursive: true });
  const archivePath = await resolved.saveAs(evidencePath);
  void archivePath;
  const zipBytes = await readFile(evidencePath);
  const entries = new Map(readStoreZip(zipBytes).map((entry) => [entry.name, entry.data]));
  const manifest = fullExportManifestSchema.parse(
    JSON.parse(entries.get("manifest.json")!.toString("utf8")),
  );
  const state = shotStateSchema.parse(JSON.parse(entries.get("shot-state.json")!.toString("utf8")));
  return { entries, manifest, state: state as unknown as ExportedState };
}

async function expectPromptsMatchState(
  entries: Map<string, Buffer>,
  state: unknown,
): Promise<void> {
  const adapterConfigs = await loadAdapterConfigs();
  const generic = adapterConfigs.find((c) => c.id === "generic_video")!;
  const target = adapterConfigs.find((c) => c.id === "seedance_video")!;
  const parsedState = shotStateSchema.parse(state);
  const [genericPrompt, targetPrompt] = await Promise.all([
    compileVideoPrompt(parsedState, new GenericVideoPromptAdapter(generic)),
    compileVideoPrompt(parsedState, new SeedanceVideoPromptAdapter(target)),
  ]);
  expect(entries.get("prompt-generic.txt")!.toString("utf8")).toBe(genericPrompt.prompt);
  expect(entries.get("prompt-seedance.txt")!.toString("utf8")).toBe(targetPrompt.prompt);
}

test("onboarding steps show before selection; full export without a frame records absent", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("onboarding-steps")).toBeVisible();
  await expect(page.getByTestId("onboarding-steps")).toContainText("使用流程");

  await selectFirstTemplate(page);
  const { entries, manifest, state } = await readFullExport(beginFullExport(page), "absent.zip");

  expect([...entries.keys()].sort()).toEqual(
    [
      "composition-raw.png",
      "manifest.json",
      "movement-end.png",
      "movement-start.png",
      "prompt-generic.txt",
      "prompt-seedance.txt",
      "shot-state.json",
    ].sort(),
  );
  expect(manifest.enhancedFrame).toEqual({ included: false, reason: "absent" });
  expect(manifest.shotState.id).toBe(state.id);
  expect(manifest.shotState.template.id).toBe("dialogue_medium_two_shot");
  expect(manifest.prompts.generic.adapterId).toBe("generic_video");
  expect(manifest.prompts.target.adapterId).toBe("seedance_video");

  for (const file of manifest.files) {
    const bytes = entries.get(file.name)!;
    expect(bytes.byteLength).toBe(file.bytes);
    expect(await sha256Hex(bytes)).toBe(file.sha256);
  }
  await expectPromptsMatchState(entries, state);
});

test("a current mock enhanced frame ships in the package with full provenance", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      externalRequests.push(request.url());
    }
  });

  await selectFirstTemplate(page);
  await page.getByTestId("enhanced-frame").locator("summary").click();
  await page.getByTestId("generate-enhanced-frame").click();
  await expect(page.getByTestId("enhanced-frame-image")).toBeVisible({ timeout: 20_000 });

  const { entries, manifest, state } = await readFullExport(
    beginFullExport(page),
    "with-frame.zip",
  );

  expect(manifest.enhancedFrame.included).toBe(true);
  if (!manifest.enhancedFrame.included) {
    throw new Error("expected the enhanced frame to be included");
  }
  expect(manifest.enhancedFrame).toMatchObject({
    fileName: "enhanced-first-frame.svg",
    provider: "mock",
  });
  expect(manifest.enhancedFrame.adapter).toMatchObject({ adapterId: "mock-image-generation" });
  expect(entries.get("enhanced-first-frame.svg")!.toString("utf8")).toContain("<svg");
  // Every hashed entry (the frame included) matches its manifest record.
  for (const file of manifest.files) {
    const bytes = entries.get(file.name)!;
    expect(await sha256Hex(bytes)).toBe(file.sha256);
  }
  await expectPromptsMatchState(entries, state);
  expect(externalRequests).toEqual([]);
});

test("an edited (stale) frame is excluded, and raw export stays usable", async ({ page }) => {
  await selectFirstTemplate(page);
  await page.getByTestId("enhanced-frame").locator("summary").click();
  await page.getByTestId("generate-enhanced-frame").click();
  await expect(page.getByTestId("enhanced-frame-image")).toBeVisible({ timeout: 20_000 });

  // Same-shot edit keeps the id but changes the state: the frame goes stale.
  await page.getByTestId("control-closer").click();
  await expect(page.getByTestId("enhanced-frame-result")).toHaveAttribute("data-stale", "true");

  const { entries, manifest, state } = await readFullExport(beginFullExport(page), "stale.zip");
  expect(manifest.enhancedFrame).toEqual({ included: false, reason: "stale" });
  expect([...entries.keys()].some((name) => name.startsWith("enhanced-first-frame"))).toBe(false);
  await expectPromptsMatchState(entries, state);

  // Raw export remains fully usable in the same session (five-file contract).
  const rawDownload = page.waitForEvent("download");
  await page.getByTestId("export-raw-zip").click();
  const raw = await rawDownload;
  expect(raw.suggestedFilename()).toMatch(/^shot-.+-raw\.zip$/);
});

test("safe-range feedback: an out-of-range refinement value stays visible, is not written, and the warning persists until corrected", async ({
  page,
}) => {
  await selectFirstTemplate(page);
  await page.getByTestId("advanced-refinement").locator("summary").click();
  const field = page.getByTestId("input-camera-position-x");
  const fieldWarning = page.getByTestId("input-camera-position-x-warning");

  // Out-of-range: the draft STAYS in the input, nothing is written (the
  // canonical state keeps the last valid value), and both the field-level
  // and the panel-level warnings show the reason.
  await field.fill("999");
  await expect(field).toHaveValue("999");
  await expect(fieldWarning).toContainText("超出工程安全范围 -2.9–2.9，未写入");
  await expect(fieldWarning).toContainText("当前保留 0");
  const warning = page.getByTestId("command-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("未写入");

  // Corrected in-range: the warning clears and the commit lands.
  await field.fill("2.5");
  await expect(fieldWarning).toHaveCount(0);
  await expect(page.getByTestId("footer-camera")).toContainText("camera [2.50, 1.62, 1.50]");
});

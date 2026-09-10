import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Download, type Page } from "@playwright/test";

import { RAW_EXPORT_FILENAMES, rawExportManifestSchema } from "../../src/domain/artifacts";
import { shotStateSchema } from "../../src/domain/shot-state";
import {
  centerRegionStats,
  changedPixelRatio,
  decodePng,
  lumaStdDev,
  meanAbsDiff,
  type DecodedPng,
} from "../helpers/png-decode";
import { readStoreZip } from "../helpers/zip-reader";

/**
 * Template-selection-through-raw-export browser evidence (Prompt 5 / Day 5,
 * extended in the fix round). Every export test downloads the REAL archive
 * and verifies it in Node with production-independent tooling: the strict
 * manifest Zod schema, an independent ZIP reader (CRC-checked) and a full
 * PNG decoder — proving pixel content, not just "files differ" — and tying
 * the rasters to the exact canonical poses that produced them.
 *
 * Downloaded packages are additionally saved under tmp/prompt5-fixes-evidence/
 * for the standalone unpack verification and local-Chrome evidence scripts.
 * The whole flow stays local: no external requests, no provider, zero cost.
 */

interface StageSnapshot {
  view: "director" | "camera";
  activeCamera: {
    name: string;
    position: [number, number, number];
    fovDeg: number;
    worldDirection: [number, number, number];
  };
  mannequins: string[];
  shotCameraInScene: boolean;
  frustumHelperVisible: boolean;
  drawingBuffer: { width: number; height: number };
}

/** Canonical dialogue_ots_a_to_b values (committed template YAML). */
const OTS_A_TO_B = {
  camera: { position: [-1.25, 1.7, 2] as const, target: [0.8, 1.55, 0] as const, focal: 75 },
  start: { position: [-1.25, 1.7, 2] as const, target: [0.8, 1.55, 0] as const },
  end: { position: [-1.05, 1.68, 1.4] as const, target: [0.8, 1.55, 0] as const },
};
/** dialogue_ots_b_to_a (mirrored reverse pair, also 75mm dolly_in). */
const OTS_B_TO_A = {
  camera: { position: [1.25, 1.7, 2] as const, target: [-0.8, 1.55, 0] as const, focal: 75 },
  start: { position: [1.25, 1.7, 2] as const, target: [-0.8, 1.55, 0] as const },
  end: { position: [1.05, 1.68, 1.4] as const, target: [-0.8, 1.55, 0] as const },
};
/** dialogue_medium_two_shot: static, all three poses identical, 35mm. */
const MEDIUM = {
  camera: { position: [0, 1.6, 3.4] as const, target: [0, 1.55, 0] as const, focal: 35 },
};
/** makeCloser on ots_a_to_b: 20% along position->target. */
const CLOSER_POSITION: [number, number, number] = [-0.84, 1.67, 1.6];
/** ease_in_out (smoothstep) eased progress at t=0.25. */
const EASED_QUARTER = 0.15625;
const MID_POSITION: [number, number, number] = [-1.15, 1.69, 1.7];
const QUARTER_POSITION: [number, number, number] = [
  -1.25 + 0.2 * EASED_QUARTER,
  1.7 - 0.02 * EASED_QUARTER,
  2.0 - 0.6 * EASED_QUARTER,
];

const SESSION_KEY = "storyboard-director.session.v1";
const EVIDENCE_DIR = path.join("tmp", "prompt5-fixes-evidence");
const EXPECTED_FILES = [
  RAW_EXPORT_FILENAMES.shotState,
  RAW_EXPORT_FILENAMES.compositionRaw,
  RAW_EXPORT_FILENAMES.movementStart,
  RAW_EXPORT_FILENAMES.movementEnd,
  RAW_EXPORT_FILENAMES.manifest,
];

function startExternalRequestLog(page: Page): string[] {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      externalRequests.push(request.url());
    }
  });
  return externalRequests;
}

async function readSnapshot(page: Page): Promise<StageSnapshot> {
  const raw = await page.getByTestId("stage-snapshot").textContent();
  return JSON.parse(raw ?? "") as StageSnapshot;
}

async function waitForSnapshot(
  page: Page,
  matches: (snapshot: StageSnapshot) => boolean,
): Promise<StageSnapshot> {
  await expect
    .poll(
      async () => {
        const raw = await page.getByTestId("stage-snapshot").textContent();
        if (raw === null || raw === "") {
          return false;
        }
        try {
          return matches(JSON.parse(raw) as StageSnapshot);
        } catch {
          return false;
        }
      },
      { timeout: 20_000 },
    )
    .toBeTruthy();
  return readSnapshot(page);
}

const positionEquals = (
  actual: [number, number, number],
  expected: readonly [number, number, number],
): boolean => actual.every((component, index) => Math.abs(component - expected[index]) < 1e-6);

function expectVecCloseTo(actual: number[], expected: readonly number[]): void {
  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index], 6);
  }
}

/** Sets the preview slider value the React way (native setter + input event). */
async function setPreviewProgress(page: Page, progress: number): Promise<void> {
  await page.getByTestId("movement-progress").evaluate((element, value) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, progress);
}

/** Structural shape of the exported shot-state.json (asserted value-by-value). */
interface ExportedShotState {
  id: string;
  schemaVersion: number;
  template: { id: string; version: number; reviewStatus: string };
  aspectRatio: string;
  camera: { position: number[]; target: number[]; focalLengthMm: number };
  movement: {
    type: string;
    durationSeconds: number;
    easing: string;
    start: { position: number[]; target: number[]; focalLengthMm: number };
    end: { position: number[]; target: number[]; focalLengthMm: number };
  };
}

interface ExportResult {
  zipBytes: Buffer;
  entryBytes: Map<string, Buffer>;
  state: ExportedShotState;
  manifest: Record<string, unknown>;
}

/**
 * Attaches the download listener FIRST and clicks export exactly once, so the
 * awaited download is unambiguously the one this export produced. Returns the
 * pending download promise for `readExportDownload`.
 */
async function beginExportDownload(page: Page): Promise<Download> {
  const download = page.waitForEvent("download");
  await page.getByTestId("export-raw-zip").click();
  return download;
}

/** Saves and fully parses one already-awaited (or still-pending) download. */
async function readExportDownload(
  download: Promise<Download> | Download,
  evidenceFile: string,
): Promise<ExportResult> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const resolved = await download;
  await resolved.saveAs(path.join(EVIDENCE_DIR, evidenceFile));
  const downloadPath = await resolved.path();
  expect(downloadPath).toBeDefined();
  const zipBytes = Buffer.from(await readFile(downloadPath!));
  const entries = readStoreZip(zipBytes); // independent reader; verifies every CRC
  expect(entries.map((entry) => entry.name)).toEqual(EXPECTED_FILES);
  const entryBytes = new Map(entries.map((entry) => [entry.name, entry.data]));
  const state = JSON.parse(
    entryBytes.get(RAW_EXPORT_FILENAMES.shotState)!.toString("utf8"),
  ) as ExportedShotState;
  const manifest = JSON.parse(
    entryBytes.get(RAW_EXPORT_FILENAMES.manifest)!.toString("utf8"),
  ) as Record<string, unknown>;
  return { zipBytes, entryBytes, state, manifest };
}

/** Convenience wrapper for tests that read the download immediately. */
async function exportAndRead(page: Page, evidenceFile: string): Promise<ExportResult> {
  const download = await beginExportDownload(page);
  return readExportDownload(download, evidenceFile);
}

/** Schema-validates the DOWNLOADED manifest and independently recomputes every hash and byte count. */
function verifyDownloadedManifest(result: ExportResult): void {
  const parsed = rawExportManifestSchema.safeParse(result.manifest);
  if (!parsed.success) {
    throw new Error(`downloaded manifest fails its executable schema: ${parsed.error.message}`);
  }
  const manifest = parsed.data;
  for (const file of manifest.files) {
    const archived = result.entryBytes.get(file.name)!;
    expect(createHash("sha256").update(archived).digest("hex")).toBe(file.sha256);
    expect(archived.byteLength).toBe(file.bytes);
  }
  // Cross-file consistency beyond what a schema can express.
  expect(manifest.shotState.id).toBe(result.state.id);
  expect(manifest.shotState.schemaVersion).toBe(result.state.schemaVersion);
  expect(manifest.shotState.template).toEqual(result.state.template);
  expect(manifest.shotState.aspectRatio).toBe(result.state.aspectRatio);
  expect(manifest.movement.type).toBe(result.state.movement.type);
  expect(manifest.movement.durationSeconds).toBe(result.state.movement.durationSeconds);
  expect(manifest.movement.easing).toBe(result.state.movement.easing);
}

/** Decodes an archived PNG and asserts complete decode, size and non-flat content. */
function decodeArchivedPng(
  result: ExportResult,
  name: string,
  dims: { width: number; height: number },
): DecodedPng {
  const raw = result.entryBytes.get(name)!;
  expect(raw.byteLength).toBeGreaterThan(1000);
  const image = decodePng(raw);
  expect(image.width).toBe(dims.width);
  expect(image.height).toBe(dims.height);
  const deviation = lumaStdDev(image);
  console.log(`[png] ${name}: ${image.width}x${image.height}, lumaStdDev ${deviation.toFixed(1)}`);
  // A flat/empty frame (single color) would sit near 0-3; real renders measure
  // 12-24 depending on the template's framing.
  expect(deviation).toBeGreaterThan(5);
  return image;
}

const LANDSCAPE = { width: 1280, height: 720 };
const PORTRAIT = { width: 720, height: 1280 };

test("movement preview scrubs eased start-to-end poses without touching the canonical camera", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("select-template-dialogue_ots_a_to_b").click();
  await page.getByTestId("view-toggle-camera").click();
  await waitForSnapshot(page, (snapshot) =>
    positionEquals(snapshot.activeCamera.position, OTS_A_TO_B.camera.position),
  );

  await expect(page.getByTestId("movement-summary")).toHaveText(
    "dolly_in · 4s · ease_in_out · 一个 start pose + 一个 end pose",
  );

  // Enabling the preview at t=0 renders the START pose (identical to the
  // template's current camera for this shot — current is not being edited).
  await page.getByTestId("preview-toggle").click();
  await setPreviewProgress(page, 0);

  // t=1 renders the END pose from the canonical movement.
  await setPreviewProgress(page, 1);
  await waitForSnapshot(page, (snapshot) =>
    positionEquals(snapshot.activeCamera.position, OTS_A_TO_B.end.position),
  );

  // t=0.5: both easings meet at the exact midpoint (ease midpoint invariance).
  await setPreviewProgress(page, 0.5);
  await waitForSnapshot(page, (snapshot) =>
    positionEquals(snapshot.activeCamera.position, MID_POSITION),
  );

  // t=0.25 under ease_in_out uses the SMOOTHSTEP progress, not linear 0.25.
  await setPreviewProgress(page, 0.25);
  await waitForSnapshot(page, (snapshot) =>
    positionEquals(snapshot.activeCamera.position, QUARTER_POSITION),
  );
  await expect(page.getByTestId("preview-pose-readout")).toContainText(
    `camera [${QUARTER_POSITION.map((value) => value.toFixed(2)).join(", ")}]`,
  );

  // The canonical current camera is untouched by the preview...
  await expect(page.getByTestId("preview-current-camera")).toContainText(
    "camera [-1.25, 1.70, 2.00] · 75mm",
  );
  await expect(page.getByTestId("footer-camera")).toContainText("camera [-1.25, 1.70, 2.00]");

  // ...and disabling the preview returns the camera view to it.
  await page.getByTestId("preview-toggle").click();
  await waitForSnapshot(page, (snapshot) =>
    positionEquals(snapshot.activeCamera.position, OTS_A_TO_B.camera.position),
  );
});

test("template selection through raw export downloads the deterministic five-file ZIP", async ({
  page,
}) => {
  test.setTimeout(120_000); // full export + PNG decodes under parallel WebGL load
  const externalRequests = startExternalRequestLog(page);
  await page.goto("/");
  await page.getByTestId("select-template-dialogue_ots_a_to_b").click();
  await page.getByTestId("view-toggle-camera").click();
  await waitForSnapshot(page, (snapshot) =>
    positionEquals(snapshot.activeCamera.position, OTS_A_TO_B.camera.position),
  );

  // One simple adjustment: the export must carry the ADJUSTED canonical state,
  // not the template defaults.
  await page.getByTestId("control-closer").click();
  await waitForSnapshot(page, (snapshot) =>
    positionEquals(snapshot.activeCamera.position, CLOSER_POSITION),
  );
  const shotStateId = (await page.getByTestId("footer-shot-state").textContent())
    ?.trim()
    .replace(/^shot-state:\s*/, "");

  const result = await exportAndRead(page, "landscape-ots-a-to-b.zip");
  expect(result.zipBytes.byteLength).toBeGreaterThan(5000);

  // --- shot-state.json: the frozen ADJUSTED canonical state. ---
  expect(result.state.id).toBe(shotStateId);
  expect(result.state.schemaVersion).toBe(1);
  expect(result.state.template).toEqual({
    id: "dialogue_ots_a_to_b",
    version: 1,
    reviewStatus: "engineering_ready",
  });
  // The adjusted current camera — NOT the template default, NOT a preview pose.
  expectVecCloseTo(result.state.camera.position, CLOSER_POSITION);
  expectVecCloseTo(result.state.camera.target, OTS_A_TO_B.camera.target);
  expect(result.state.camera.focalLengthMm).toBe(75); // OTS stays at the template's 75mm
  expect(result.state.aspectRatio).toBe("16:9");
  // Start/end poses come from the template movement, untouched by the edit.
  expectVecCloseTo(result.state.movement.start.position, OTS_A_TO_B.start.position);
  expectVecCloseTo(result.state.movement.start.target, OTS_A_TO_B.start.target);
  expectVecCloseTo(result.state.movement.end.position, OTS_A_TO_B.end.position);
  expectVecCloseTo(result.state.movement.end.target, OTS_A_TO_B.end.target);
  expect(result.state.movement).toMatchObject({
    type: "dolly_in",
    durationSeconds: 4,
    easing: "ease_in_out",
  });

  // --- PNGs: complete, correctly sized, non-flat, and pose-associated. ---
  const composition = decodeArchivedPng(result, "composition-raw.png", LANDSCAPE);
  const start = decodeArchivedPng(result, "movement-start.png", LANDSCAPE);
  const end = decodeArchivedPng(result, "movement-end.png", LANDSCAPE);
  const startVsEnd = meanAbsDiff(start, end);
  console.log(`[diff] start vs end meanAbsDiff ${startVsEnd.toFixed(2)}`);
  expect(startVsEnd).toBeGreaterThan(1); // the dolly physically moved the framing
  expect(changedPixelRatio(start, end)).toBeGreaterThan(0.01);
  const compositionVsStart = meanAbsDiff(composition, start);
  console.log(`[diff] adjusted composition vs start meanAbsDiff ${compositionVsStart.toFixed(2)}`);
  expect(compositionVsStart).toBeGreaterThan(1); // the closer edit changed the composition

  // --- manifest: schema + independent hashes + cross-file identity. ---
  verifyDownloadedManifest(result);

  // --- UI feedback and canonical-state hygiene. ---
  await expect(page.getByTestId("export-status")).toContainText("已生成 shot-");
  await expect(page.getByTestId("export-status")).toContainText("5 个文件");
  // localStorage keeps ONLY the ShotState session envelope: no PNG, ZIP or
  // manifest data ever enters persisted state.
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_KEY);
  expect(stored).not.toBeNull();
  expect(stored).not.toContain("iVBOR"); // PNG base64 prefix
  expect(stored).not.toContain("manifestVersion");
  expect(stored).not.toContain("application/zip");
  const envelope = JSON.parse(stored!) as { version: number };
  expect(envelope.version).toBe(1);

  expect(externalRequests).toEqual([]);
});

test("P1-1 regression: a target-only edit exports the re-aimed composition, not the stale frame", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByTestId("select-template-dialogue_ots_a_to_b").click();
  // Advanced refinement: move ONLY the current camera target x 0.8 -> -0.8.
  await page.getByTestId("advanced-refinement").locator("summary").click();
  await page.getByTestId("input-camera-target-x").fill("-0.8");
  await expect(page.getByTestId("footer-camera")).toContainText("→ [-0.80, 1.55, 0.00]");
  await expect(page.getByTestId("footer-camera")).toContainText("camera [-1.25, 1.70, 2.00]");

  const result = await exportAndRead(page, "target-only-fixed.zip");

  // The state carries the edit on the CURRENT camera only; movement.start
  // still aims at +0.8 with identical position and focal length.
  expectVecCloseTo(result.state.camera.position, OTS_A_TO_B.camera.position);
  expectVecCloseTo(result.state.camera.target, [-0.8, 1.55, 0]);
  expect(result.state.camera.focalLengthMm).toBe(75);
  expectVecCloseTo(result.state.movement.start.position, OTS_A_TO_B.start.position);
  expectVecCloseTo(result.state.movement.start.target, OTS_A_TO_B.start.target);
  expectVecCloseTo(result.state.movement.end.target, OTS_A_TO_B.end.target);

  // Pixel-level proof, decoded from the downloaded PNGs: the composition is
  // NOT a reuse of the start frame (the accepted counterexample produced
  // byte-identical images here).
  const composition = decodeArchivedPng(result, "composition-raw.png", LANDSCAPE);
  const start = decodeArchivedPng(result, "movement-start.png", LANDSCAPE);
  const end = decodeArchivedPng(result, "movement-end.png", LANDSCAPE);
  const compositionVsStart = meanAbsDiff(composition, start);
  const ratioVsStart = changedPixelRatio(composition, start);
  console.log(
    `[target-only] composition vs start meanAbsDiff ${compositionVsStart.toFixed(2)}, changedRatio ${(ratioVsStart * 100).toFixed(2)}%`,
  );
  expect(compositionVsStart).toBeGreaterThan(1.5);
  expect(ratioVsStart).toBeGreaterThan(0.01);
  // The dolly still moved between start and end.
  expect(meanAbsDiff(start, end)).toBeGreaterThan(1);

  // Pose-to-pixel association: aiming at character A (blue-grey #8a9aa8)
  // tilts the frame center blue; aiming at character B (warm #a8908a) tilts
  // it red. The two frames must differ in exactly that direction.
  const compositionTilt = centerRegionStats(composition).blueMinusRed;
  const startTilt = centerRegionStats(start).blueMinusRed;
  console.log(
    `[target-only] center blue-minus-red: composition ${compositionTilt.toFixed(2)} vs start ${startTilt.toFixed(2)}`,
  );
  expect(compositionTilt - startTilt).toBeGreaterThan(1.5);

  verifyDownloadedManifest(result);
});

const OTS_EXPORT_CASES = [
  { id: "dialogue_ots_a_to_b", spec: OTS_A_TO_B, evidence: "ots-a-to-b-poses.zip" },
  { id: "dialogue_ots_b_to_a", spec: OTS_B_TO_A, evidence: "ots-b-to-a-poses.zip" },
] as const;

/** One full export per OTS template; each gets its own test budget. */
async function verifyOtsExport(
  page: Page,
  testCase: (typeof OTS_EXPORT_CASES)[number],
): Promise<void> {
  await page.goto("/");
  await page.getByTestId(`select-template-${testCase.id}`).click();
  const result = await exportAndRead(page, testCase.evidence);

  expect(result.state.template.id).toBe(testCase.id);
  expect(result.state.template.reviewStatus).toBe("engineering_ready");
  expect(result.state.camera.focalLengthMm).toBe(testCase.spec.camera.focal);
  expectVecCloseTo(result.state.camera.position, testCase.spec.camera.position);
  expectVecCloseTo(result.state.camera.target, testCase.spec.camera.target);
  expectVecCloseTo(result.state.movement.start.position, testCase.spec.start.position);
  expectVecCloseTo(result.state.movement.start.target, testCase.spec.start.target);
  expectVecCloseTo(result.state.movement.end.position, testCase.spec.end.position);
  expectVecCloseTo(result.state.movement.end.target, testCase.spec.end.target);
  expect(result.state.movement.type).toBe("dolly_in");

  const start = decodeArchivedPng(result, "movement-start.png", LANDSCAPE);
  const end = decodeArchivedPng(result, "movement-end.png", LANDSCAPE);
  decodeArchivedPng(result, "composition-raw.png", LANDSCAPE);
  const diff = meanAbsDiff(start, end);
  console.log(`[ots-poses] ${testCase.id} start vs end meanAbsDiff ${diff.toFixed(2)}`);
  expect(diff).toBeGreaterThan(1);

  verifyDownloadedManifest(result);
}

test("OTS A-to-B exports its current/start/end frames end to end", async ({ page }) => {
  test.setTimeout(120_000); // full export + PNG decodes under parallel WebGL load
  await verifyOtsExport(page, OTS_EXPORT_CASES[0]);
});

test("OTS B-to-A exports its current/start/end frames end to end", async ({ page }) => {
  test.setTimeout(120_000);
  await verifyOtsExport(page, OTS_EXPORT_CASES[1]);
});

test("the static template exports three identical poses without waiting for a change", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByTestId("select-template-dialogue_medium_two_shot").click();
  const result = await exportAndRead(page, "static-medium-two-shot.zip");

  // All three poses are exactly the template camera; the export must not
  // hang waiting for a pose "change" that never comes.
  expectVecCloseTo(result.state.camera.position, MEDIUM.camera.position);
  expectVecCloseTo(result.state.movement.start.position, MEDIUM.camera.position);
  expectVecCloseTo(result.state.movement.start.target, MEDIUM.camera.target);
  expectVecCloseTo(result.state.movement.end.position, MEDIUM.camera.position);
  expectVecCloseTo(result.state.movement.end.target, MEDIUM.camera.target);
  expect(result.state.movement.type).toBe("static");
  expect(result.state.movement.start.focalLengthMm).toBe(35);

  const composition = decodeArchivedPng(result, "composition-raw.png", LANDSCAPE);
  const start = decodeArchivedPng(result, "movement-start.png", LANDSCAPE);
  const end = decodeArchivedPng(result, "movement-end.png", LANDSCAPE);
  // Identical poses render deterministically identical frames.
  const compositionVsStart = meanAbsDiff(composition, start);
  const startVsEnd = meanAbsDiff(start, end);
  console.log(
    `[static] composition vs start ${compositionVsStart.toFixed(3)}, start vs end ${startVsEnd.toFixed(3)}`,
  );
  expect(compositionVsStart).toBeLessThan(0.5);
  expect(startVsEnd).toBeLessThan(0.5);

  verifyDownloadedManifest(result);
});

test("a portrait export produces valid 720x1280 rasters and 9:16 metadata", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByTestId("select-template-dialogue_ots_b_to_a").click();
  await page.getByTestId("control-aspect-916").click();
  await expect(page.getByTestId("footer-camera")).toContainText("9:16");
  const result = await exportAndRead(page, "portrait-ots-b-to-a.zip");

  expect(result.state.aspectRatio).toBe("9:16");
  decodeArchivedPng(result, "composition-raw.png", PORTRAIT);
  const start = decodeArchivedPng(result, "movement-start.png", PORTRAIT);
  const end = decodeArchivedPng(result, "movement-end.png", PORTRAIT);
  const diff = meanAbsDiff(start, end);
  console.log(`[portrait] start vs end meanAbsDiff ${diff.toFixed(2)}`);
  expect(diff).toBeGreaterThan(1);
  verifyDownloadedManifest(result);
});

test("a preview parked mid-timeline never leaks into the exported package", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByTestId("select-template-dialogue_ots_a_to_b").click();
  await page.getByTestId("view-toggle-camera").click();
  await waitForSnapshot(page, (snapshot) =>
    positionEquals(snapshot.activeCamera.position, OTS_A_TO_B.camera.position),
  );
  // Park the tween preview at the interpolated midpoint (visible in camera view).
  await page.getByTestId("preview-toggle").click();
  await setPreviewProgress(page, 0.5);
  await waitForSnapshot(page, (snapshot) =>
    positionEquals(snapshot.activeCamera.position, MID_POSITION),
  );

  const result = await exportAndRead(page, "preview-parked.zip");
  // The exported CURRENT camera is the canonical template pose — not the
  // interpolated midpoint the user was looking at.
  expectVecCloseTo(result.state.camera.position, OTS_A_TO_B.camera.position);
  expectVecCloseTo(result.state.camera.target, OTS_A_TO_B.camera.target);
  expectVecCloseTo(result.state.movement.start.position, OTS_A_TO_B.start.position);
  expectVecCloseTo(result.state.movement.end.position, OTS_A_TO_B.end.position);
  // Pixel association: current == start pose for this template, so their
  // rasters are identical; a leaked mid-pose composition would differ.
  const composition = decodeArchivedPng(result, "composition-raw.png", LANDSCAPE);
  const start = decodeArchivedPng(result, "movement-start.png", LANDSCAPE);
  const diff = meanAbsDiff(composition, start);
  console.log(`[preview-parked] composition vs start meanAbsDiff ${diff.toFixed(3)}`);
  expect(diff).toBeLessThan(0.5);
  verifyDownloadedManifest(result);
});

test("edits made during capture cannot pollute the frozen snapshot", async ({ page }) => {
  test.setTimeout(120_000);
  // Test-side capture sync point (installed before any page script runs): while
  // the hold flag is set, every HTMLCanvasElement.toBlob invocation is queued
  // instead of executed. This makes "the edit happened while the FIRST capture
  // was in flight" a deterministic fact (a held PNG callback PROVES capture
  // had started and not finished), not a race. Production code is untouched.
  await page.addInitScript(() => {
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
    const queue: Array<{
      canvas: HTMLCanvasElement;
      callback: BlobCallback;
      type?: string;
    }> = [];
    const scope = window as unknown as Record<string, unknown>;
    scope.__pngHold = false;
    scope.__pngHeldCount = 0;
    HTMLCanvasElement.prototype.toBlob = function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
    ) {
      if (scope.__pngHold === true) {
        scope.__pngHeldCount = (scope.__pngHeldCount as number) + 1;
        queue.push({ canvas: this, callback, type });
        return;
      }
      return nativeToBlob.call(this, callback, type);
    };
    scope.__releasePngHold = () => {
      scope.__pngHold = false;
      const pending = queue.splice(0);
      for (const held of pending) {
        nativeToBlob.call(held.canvas, held.callback, held.type);
      }
    };
  });
  await page.goto("/");
  await page.getByTestId("select-template-dialogue_ots_a_to_b").click();

  // Hold PNG capture, then start exactly ONE export with the download listener
  // already attached.
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__pngHold = true;
  });
  const downloadPromise = beginExportDownload(page);

  // Deterministic in-flight proof: at least one capture PNG callback has been
  // called and is being held — the export is mid-capture and cannot progress.
  await page.waitForFunction(
    () => (window as unknown as Record<string, number>).__pngHeldCount >= 1,
  );

  // Edit the live canonical state while the capture is held.
  await page.getByTestId("control-focal-compressed").click();
  // The edit DID land (footer shows 85mm) while the frozen capture is paused.
  await expect(page.getByTestId("footer-camera")).toContainText("85mm");

  // Release the held capture; the export finishes from the FROZEN snapshot.
  await page.evaluate(() => {
    (window as unknown as Record<string, () => void>).__releasePngHold();
  });
  const result = await readExportDownload(downloadPromise, "mid-capture-edit.zip");

  // --- shot-state.json: canonical schema + frozen-at-click values. ---
  const stateParsed = shotStateSchema.safeParse(result.state);
  if (!stateParsed.success) {
    throw new Error(
      `downloaded shot-state.json fails the canonical schema: ${stateParsed.error.message}`,
    );
  }
  // The live state is 85mm now, but the package froze the 75mm template focal.
  expect(stateParsed.data.camera.focalLengthMm).toBe(75);
  expectVecCloseTo(stateParsed.data.camera.position, OTS_A_TO_B.camera.position);
  expectVecCloseTo(stateParsed.data.camera.target, OTS_A_TO_B.camera.target);

  // --- manifest.json: executable schema, cross-file metadata, hashes. ---
  const manifestParsed = rawExportManifestSchema.safeParse(result.manifest);
  if (!manifestParsed.success) {
    throw new Error(
      `downloaded manifest fails its executable schema: ${manifestParsed.error.message}`,
    );
  }
  expect(manifestParsed.data.shotState.id).toBe(stateParsed.data.id);
  expect(manifestParsed.data.shotState.template).toEqual(stateParsed.data.template);
  expect(manifestParsed.data.shotState.aspectRatio).toBe(stateParsed.data.aspectRatio);
  expect(manifestParsed.data.movement.type).toBe(stateParsed.data.movement.type);
  expect(manifestParsed.data.movement.durationSeconds).toBe(
    stateParsed.data.movement.durationSeconds,
  );
  expect(manifestParsed.data.movement.easing).toBe(stateParsed.data.movement.easing);
  // Independent hash + byteLength recomputation for every hashed artifact.
  for (const file of manifestParsed.data.files) {
    const archived = result.entryBytes.get(file.name)!;
    expect(createHash("sha256").update(archived).digest("hex")).toBe(file.sha256);
    expect(archived.byteLength).toBe(file.bytes);
  }

  // --- Frozen images: the three rasters still decode as valid renders. ---
  decodeArchivedPng(result, "composition-raw.png", LANDSCAPE);
  decodeArchivedPng(result, "movement-start.png", LANDSCAPE);
  decodeArchivedPng(result, "movement-end.png", LANDSCAPE);
});

test("repeat exports from one session are stable except the generation timestamp", async ({
  page,
}) => {
  test.setTimeout(150_000); // two full exports + PNG decodes
  await page.goto("/");
  await page.getByTestId("select-template-dialogue_medium_two_shot").click();

  const first = await exportAndRead(page, "repeat-1.zip");
  const second = await exportAndRead(page, "repeat-2.zip");

  // Same session (same ShotState ID) in both packages.
  expect(second.state.id).toBe(first.state.id);
  // The canonical state and all three rasters are byte-identical across the
  // two downloads: the only legitimate difference is the manifest timestamp.
  expect(
    Buffer.compare(
      first.entryBytes.get(RAW_EXPORT_FILENAMES.shotState)!,
      second.entryBytes.get(RAW_EXPORT_FILENAMES.shotState)!,
    ),
  ).toBe(0);
  for (const png of [
    RAW_EXPORT_FILENAMES.compositionRaw,
    RAW_EXPORT_FILENAMES.movementStart,
    RAW_EXPORT_FILENAMES.movementEnd,
  ]) {
    expect(Buffer.compare(first.entryBytes.get(png)!, second.entryBytes.get(png)!)).toBe(0);
  }
  const manifestFirst = { ...(first.manifest as Record<string, unknown>) };
  const manifestSecond = { ...(second.manifest as Record<string, unknown>) };
  delete manifestFirst.generatedAt;
  delete manifestSecond.generatedAt;
  expect(manifestSecond).toEqual(manifestFirst);
  // (generatedAt MAY differ between two real-time exports; that difference is
  // expected and is not a determinism failure. Byte determinism under an
  // IDENTICAL timestamp is covered by the unit suite.)
  verifyDownloadedManifest(first);
  verifyDownloadedManifest(second);
});

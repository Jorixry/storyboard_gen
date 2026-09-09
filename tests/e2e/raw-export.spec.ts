import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

import { readStoreZip } from "../helpers/zip-reader";

/**
 * Template-selection-through-raw-export browser test (Prompt 5 / Phase 1
 * Day 5): development template -> optional adjustment -> movement tween
 * preview at eased scrub positions -> raw ZIP download, verified end-to-end
 * against the ACTUAL downloaded archive bytes (independent ZIP reader +
 * node:crypto hashes). The whole flow stays local: no external requests, no
 * provider calls, zero credits.
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
const START_POSITION: [number, number, number] = [-1.25, 1.7, 2];
const END_POSITION: [number, number, number] = [-1.05, 1.68, 1.4];
/** makeCloser steps 20% along position->target: [-1.25,1.7,2] + 0.2*[2.05,-0.15,-2]. */
const CLOSER_POSITION: [number, number, number] = [-0.84, 1.67, 1.6];
/** ease_in_out (smoothstep) eased progress. */
const EASED_QUARTER = 0.15625;
const MID_POSITION: [number, number, number] = [-1.15, 1.69, 1.7];
const QUARTER_POSITION: [number, number, number] = [
  -1.25 + 0.2 * EASED_QUARTER,
  1.7 - 0.02 * EASED_QUARTER,
  2.0 - 0.6 * EASED_QUARTER,
];

const SESSION_KEY = "storyboard-director.session.v1";

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
  expected: [number, number, number],
): boolean => actual.every((component, index) => Math.abs(component - expected[index]) < 1e-6);

function expectVecCloseTo(actual: number[], expected: [number, number, number]): void {
  for (let index = 0; index < 3; index += 1) {
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

function pngDimensions(png: Buffer): { width: number; height: number } {
  if (png.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new Error("not a PNG: signature mismatch");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test("movement preview scrubs eased start-to-end poses without touching the canonical camera", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("select-template-dialogue_ots_a_to_b").click();
  await page.getByTestId("view-toggle-camera").click();
  await waitForSnapshot(page, (snapshot) =>
    positionEquals(snapshot.activeCamera.position, START_POSITION),
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
    positionEquals(snapshot.activeCamera.position, END_POSITION),
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
    `camera [${QUARTER_POSITION.map((v) => v.toFixed(2)).join(", ")}]`,
  );

  // The canonical current camera is untouched by the preview...
  await expect(page.getByTestId("preview-current-camera")).toContainText(
    "camera [-1.25, 1.70, 2.00] · 50mm",
  );
  await expect(page.getByTestId("footer-camera")).toContainText("camera [-1.25, 1.70, 2.00]");

  // ...and disabling the preview returns the camera view to it.
  await page.getByTestId("preview-toggle").click();
  await waitForSnapshot(page, (snapshot) =>
    positionEquals(snapshot.activeCamera.position, START_POSITION),
  );
});

test("template selection through raw export downloads the deterministic five-file ZIP", async ({
  page,
}) => {
  const externalRequests = startExternalRequestLog(page);
  await page.goto("/");
  await page.getByTestId("select-template-dialogue_ots_a_to_b").click();
  await page.getByTestId("view-toggle-camera").click();
  await waitForSnapshot(page, (snapshot) =>
    positionEquals(snapshot.activeCamera.position, START_POSITION),
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

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-raw-zip").click(),
  ]);
  expect(download.suggestedFilename()).toBe(`shot-${shotStateId}-raw.zip`);
  const downloadPath = await download.path();
  expect(downloadPath).toBeDefined();
  const zipBytes = Buffer.from(await readFile(downloadPath!));

  // --- Archive layout: exactly the five documented files, in order. ---
  const entries = readStoreZip(zipBytes); // also verifies every entry's CRC-32
  expect(entries.map((entry) => entry.name)).toEqual([
    "shot-state.json",
    "composition-raw.png",
    "movement-start.png",
    "movement-end.png",
    "manifest.json",
  ]);
  const byName = new Map(entries.map((entry) => [entry.name, entry.data]));

  // --- shot-state.json: the frozen ADJUSTED canonical state. ---
  const exportedState = JSON.parse(byName.get("shot-state.json")!.toString("utf8"));
  expect(exportedState.id).toBe(shotStateId);
  expect(exportedState.schemaVersion).toBe(1);
  expect(exportedState.template).toEqual({
    id: "dialogue_ots_a_to_b",
    version: 1,
    reviewStatus: "engineering_ready",
  });
  // The adjusted current camera — NOT the template default, NOT a preview pose.
  expectVecCloseTo(exportedState.camera.position, CLOSER_POSITION);
  expect(exportedState.camera.focalLengthMm).toBe(50); // OTS stays 50mm
  expect(exportedState.aspectRatio).toBe("16:9");
  // Start/end poses come from the template movement, untouched by the edit.
  expect(exportedState.movement).toMatchObject({
    type: "dolly_in",
    durationSeconds: 4,
    easing: "ease_in_out",
    start: {
      position: START_POSITION,
      target: [0.8, 1.55, 0],
      focalLengthMm: 50,
    },
    end: {
      position: END_POSITION,
      target: [0.8, 1.55, 0],
      focalLengthMm: 50,
    },
  });

  // --- PNGs: 1280x720 rasters captured through the camera view. ---
  for (const name of ["composition-raw.png", "movement-start.png", "movement-end.png"]) {
    const png = byName.get(name)!;
    expect(png.byteLength).toBeGreaterThan(1000);
    expect(pngDimensions(png)).toEqual({ width: 1280, height: 720 });
  }
  // Distinct poses produce distinct frames: start/end differ, and the adjusted
  // current composition differs from both.
  expect(byName.get("movement-start.png")!.equals(byName.get("movement-end.png")!)).toBe(false);
  expect(byName.get("composition-raw.png")!.equals(byName.get("movement-start.png")!)).toBe(false);

  // --- manifest.json: versioned, hash-covering, same-state. ---
  const manifest = JSON.parse(byName.get("manifest.json")!.toString("utf8"));
  expect(manifest.kind).toBe("storyboard-director-raw-export");
  expect(manifest.manifestVersion).toBe(1);
  expect(typeof manifest.generatedAt).toBe("string");
  expect(manifest.shotState).toEqual({
    id: shotStateId,
    schemaVersion: 1,
    template: exportedState.template,
    aspectRatio: "16:9",
  });
  expect(manifest.movement).toEqual({
    type: "dolly_in",
    durationSeconds: 4,
    easing: "ease_in_out",
  });
  expect(manifest.files.map((file: { name: string }) => file.name)).toEqual([
    "shot-state.json",
    "composition-raw.png",
    "movement-start.png",
    "movement-end.png",
  ]);
  for (const file of manifest.files as Array<{ name: string; sha256: string; bytes: number }>) {
    const archived = byName.get(file.name)!;
    expect(createHash("sha256").update(archived).digest("hex")).toBe(file.sha256);
    expect(archived.byteLength).toBe(file.bytes);
  }

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

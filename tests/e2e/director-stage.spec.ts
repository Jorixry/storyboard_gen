import { expect, test } from "@playwright/test";

/**
 * Browser and visual evidence for the static director stage (Prompt 3 /
 * Phase 1 Day 3). Assertions read the scene snapshot the stage reports once
 * the correct active camera is live; visual regressions are gated by
 * committed toHaveScreenshot baselines (tests/e2e/director-stage.spec.ts-snapshots/
 * — version-controlled, generated at fixed 1280x720 / dpr=1). The footer
 * ShotState ID is unique per load and is masked in the baselines.
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

/** Canonical ShotState values of the dialogue_ots_a_to_b development fixture. */
const SHOT_CAMERA_POSITION: [number, number, number] = [-1.25, 1.7, 2];
const SHOT_CAMERA_TARGET: [number, number, number] = [0.8, 1.55, 0];
const SHOT_CAMERA_VFOV_DEG = 15.376895539805746; // 2*atan(20.25/150), 75mm on the 16:9 gate
const INSPECTION_CAMERA_POSITION: [number, number, number] = [2.7, 2.3, 4.1];

function normalize(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function expectVec3CloseTo(
  actual: [number, number, number],
  expected: [number, number, number],
  precision = 6,
): void {
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
  expect(actual[2]).toBeCloseTo(expected[2], precision);
}

async function readSnapshot(page: import("@playwright/test").Page): Promise<StageSnapshot> {
  const raw = await page.getByTestId("stage-snapshot").textContent();
  return JSON.parse(raw ?? "") as StageSnapshot;
}

async function waitForStageView(
  page: import("@playwright/test").Page,
  view: "director" | "camera",
): Promise<StageSnapshot> {
  await expect(page.locator(".director-stage")).toHaveAttribute("data-stage-ready", "true");
  await expect(page.locator(".director-stage")).toHaveAttribute("data-snapshot-view", view);
  return readSnapshot(page);
}

test("director stage labels the engineering_ready development fixture", async ({ page }) => {
  await page.goto("/director");
  await expect(page.getByRole("heading", { name: "Director Stage" })).toBeVisible();
  await expect(page.getByText("DEVELOPMENT FIXTURE", { exact: true })).toBeVisible();
  await expect(page.getByText("engineering_ready · not director approved")).toBeVisible();
  await expect(page.getByText("dialogue_ots_a_to_b v1")).toBeVisible();
  await expect(page.getByText(/75mm \(vFOV 15\.38°\) · 16:9/)).toBeVisible();
});

test("director view shows both mannequins, the shot camera and its frustum from the inspection camera", async ({
  page,
}) => {
  await page.goto("/director");
  const snapshot = await waitForStageView(page, "director");

  expect(snapshot.view).toBe("director");
  // Both generic mannequins are present, driven by the fixture state.
  expect(snapshot.mannequins).toEqual(["character_a", "character_b"]);
  // The shot camera object and an accurate frustum helper are in the scene.
  expect(snapshot.shotCameraInScene).toBe(true);
  expect(snapshot.frustumHelperVisible).toBe(true);
  // The active camera is the fixed inspection camera, never the shot camera.
  expect(snapshot.activeCamera.name).toBe("director-inspection-camera");
  expectVec3CloseTo(snapshot.activeCamera.position, INSPECTION_CAMERA_POSITION);
  expect(snapshot.activeCamera.position).not.toEqual(SHOT_CAMERA_POSITION);
  // Fixed director-view frame: full stage width at dpr=1.
  expect(snapshot.drawingBuffer.width).toBe(1280);
  expect(snapshot.drawingBuffer.height).toBe(584);
});

test("camera view renders through the canonical ShotState camera, not the director camera", async ({
  page,
}) => {
  await page.goto("/director");
  await waitForStageView(page, "director");

  await page.getByTestId("view-toggle-camera").click();
  const snapshot = await waitForStageView(page, "camera");

  expect(snapshot.view).toBe("camera");
  expect(snapshot.mannequins).toEqual(["character_a", "character_b"]);
  // The active camera is the shot camera built from the ShotState.
  expect(snapshot.activeCamera.name).toBe("shot-camera");
  expectVec3CloseTo(snapshot.activeCamera.position, SHOT_CAMERA_POSITION);
  expect(snapshot.activeCamera.fovDeg).toBeCloseTo(SHOT_CAMERA_VFOV_DEG, 6);
  expect(snapshot.activeCamera.fovDeg).not.toBeCloseTo(50, 6);
  // It looks exactly at the ShotState target.
  const expectedDirection = normalize([
    SHOT_CAMERA_TARGET[0] - SHOT_CAMERA_POSITION[0],
    SHOT_CAMERA_TARGET[1] - SHOT_CAMERA_POSITION[1],
    SHOT_CAMERA_TARGET[2] - SHOT_CAMERA_POSITION[2],
  ]);
  expectVec3CloseTo(snapshot.activeCamera.worldDirection, expectedDirection);
  // It is definitively not the director inspection camera.
  expect(snapshot.activeCamera.position).not.toEqual(INSPECTION_CAMERA_POSITION);
  // No helper chrome inside the camera-view frame.
  expect(snapshot.frustumHelperVisible).toBe(false);
  // Camera-view frame keeps the fixture aspect ratio at dpr=1.
  const aspect = snapshot.drawingBuffer.width / snapshot.drawingBuffer.height;
  expect(aspect).toBeCloseTo(16 / 9, 2);
});

test("view toggle switches back and forth between director and camera views", async ({ page }) => {
  await page.goto("/director");
  await waitForStageView(page, "director");

  await page.getByTestId("view-toggle-camera").click();
  await waitForStageView(page, "camera");
  await expect(page.locator(".director-stage")).toHaveAttribute("data-active-view", "camera");

  await page.getByTestId("view-toggle-director").click();
  const snapshot = await waitForStageView(page, "director");
  await expect(page.locator(".director-stage")).toHaveAttribute("data-active-view", "director");
  expect(snapshot.frustumHelperVisible).toBe(true);
});

test("director stage makes no external network requests", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      externalRequests.push(request.url());
    }
  });
  await page.goto("/director");
  await waitForStageView(page, "director");
  await page.getByTestId("view-toggle-camera").click();
  await waitForStageView(page, "camera");
  expect(externalRequests).toEqual([]);
});

test("matches the committed visual baselines for director and camera views", async ({ page }) => {
  await page.goto("/director");
  await waitForStageView(page, "director");
  // The ShotState ID is unique per load, so its footer region is masked;
  // everything else (fixed 1280x720 viewport, dpr=1, static scene) must match
  // the committed baseline. A 1% pixel budget absorbs the subpixel
  // antialiasing nondeterminism of cross-process WebGL rasterization
  // (measured ~0.25% run-to-run); any structural change — a missing
  // mannequin, camera, frustum or badge — dwarfs this budget.
  const baselineOptions = {
    animations: "disabled" as const,
    mask: [page.getByTestId("footer-shot-state")],
    maxDiffPixelRatio: 0.01,
  };
  await expect(page).toHaveScreenshot(baselineOptions);

  await page.getByTestId("view-toggle-camera").click();
  await waitForStageView(page, "camera");
  await expect(page).toHaveScreenshot(baselineOptions);
});

test("director-view frustum wires are protected by a local visual assertion", async ({ page }) => {
  await page.goto("/director");
  await waitForStageView(page, "director");
  // Companion to the 1% whole-page baseline above: a cropped region around
  // the thin CameraHelper frustum lines. If the frustum disappeared, the
  // missing wire pixels would exceed this local budget even when they could
  // hide inside the whole-page 1% allowance. Region: the central stage area
  // where the shot camera body and its frustum are rendered (viewport is
  // 1280x720; the stage canvas occupies y=108..692).
  const frustumRegion = { x: 320, y: 200, width: 640, height: 320 };
  await expect(page).toHaveScreenshot({
    animations: "disabled" as const,
    clip: frustumRegion,
    maxDiffPixelRatio: 0.01,
  });
});

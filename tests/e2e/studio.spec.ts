import { expect, test, type Page } from "@playwright/test";

/**
 * Browser evidence for the Prompt 4 / Phase 1 Day 4 studio: development
 * template gallery, simple semantic controls, progressive-disclosure
 * constrained refinement, local session persistence and regression of the
 * Prompt 3 director/camera views. All assertions wait for the deterministic
 * stage readiness gate (data-stage-ready / snapshot values) — never on
 * animation frames, timers or random values. The suite makes no external
 * network requests and no provider calls.
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

/** Independently derived FOV constants (2*atan(verticalGate/(2*f)) in degrees). */
const VFOV_75MM_169 = 15.376895539805746;
const VFOV_75MM_916 = 26.991466561591626;
/** 50mm portrait PRESET FOV — a product alias value, not a template default. */
const VFOV_50MM_169 = 22.895192527371208;

/** Canonical template camera values (from the committed template YAML). */
const OTS_A_TO_B_CAMERA: [number, number, number] = [-1.25, 1.7, 2];
const MEDIUM_CAMERA: [number, number, number] = [0, 1.6, 3.4];

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

async function selectTemplate(page: Page, templateId: string): Promise<void> {
  await page.getByTestId(`select-template-${templateId}`).click();
}

async function waitForReadyView(page: Page, view: "director" | "camera"): Promise<void> {
  await expect(page.locator(".director-stage")).toHaveAttribute("data-stage-ready", "true");
  await expect(page.locator(".director-stage")).toHaveAttribute("data-snapshot-view", view);
}

/**
 * Polls the live stage snapshot until it satisfies the predicate. This is the
 * deterministic post-edit readiness gate: an edited camera only reports once
 * the rendered numbers match the canonical state.
 */
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
      { timeout: 15_000 },
    )
    .toBeTruthy();
  return readSnapshot(page);
}

const positionEquals = (
  actual: [number, number, number],
  expected: [number, number, number],
): boolean => actual.every((component, index) => Math.abs(component - expected[index]) < 1e-6);

/**
 * NOTE: no localStorage-clearing beforeEach. Playwright gives every test a
 * fresh browser context, and an addInitScript-based cleaner would also run on
 * page.reload() and wipe the very session the persistence tests restore.
 */

test("gallery shows the three clearly labeled development templates", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("studio-root")).toBeVisible();
  await expect(page.getByTestId("gallery-development-note")).toContainText("DEVELOPMENT GALLERY");
  await expect(page.getByTestId("gallery-development-note")).toContainText("not director approved");

  const cards = page.getByTestId("template-card");
  await expect(cards).toHaveCount(3);
  const expectedIds = ["dialogue_medium_two_shot", "dialogue_ots_a_to_b", "dialogue_ots_b_to_a"];
  for (let index = 0; index < 3; index += 1) {
    const card = cards.nth(index);
    await expect(card).toHaveAttribute("data-template-id", expectedIds[index]);
    await expect(card.getByText("DEVELOPMENT", { exact: true })).toBeVisible();
    await expect(card.getByTestId("template-review-status")).toHaveText(
      "engineering_ready · not director approved",
    );
    await expect(card.getByTestId("template-meta")).toContainText(`${expectedIds[index]} v1`);
    await expect(card.getByTestId("template-narrative-purpose")).not.toBeEmpty();
  }
  // The production boundary stays visible: zero approved templates today.
  await expect(page.getByTestId("production-template-count")).toHaveText("production gallery: 0");
});

test("gallery reference images load locally with zero external requests", async ({ page }) => {
  const externalRequests = startExternalRequestLog(page);
  await page.goto("/");
  const images = page.locator(".template-card-image-wrap img");
  await expect(images).toHaveCount(3);
  // All three local reference images decode successfully (no broken icons).
  const naturalWidths = await images.evaluateAll((nodes) =>
    (nodes as HTMLImageElement[]).map((node) => node.naturalWidth),
  );
  expect(naturalWidths.every((width) => width > 0)).toBe(true);
  // All three sources point at the same-origin reference-images directory.
  const sources = await images.evaluateAll((nodes) =>
    (nodes as HTMLImageElement[]).map((node) => node.getAttribute("src")),
  );
  expect(sources.every((src) => src !== null && src.startsWith("/reference-images/"))).toBe(true);
  expect(externalRequests).toEqual([]);
});

test("selecting a different template updates ShotState metadata and the camera preview", async ({
  page,
}) => {
  await page.goto("/");
  await selectTemplate(page, "dialogue_medium_two_shot");
  await waitForReadyView(page, "director");
  await expect(page.getByTestId("footer-template")).toContainText(
    "dialogue_medium_two_shot v1 · engineering_ready",
  );
  await expect(page.getByTestId("footer-camera")).toContainText("35mm");

  await page.getByTestId("view-toggle-camera").click();
  let snapshot = await waitForSnapshot(page, (s) => s.view === "camera");
  expect(positionEquals(snapshot.activeCamera.position, MEDIUM_CAMERA)).toBe(true);

  // Re-selecting a DIFFERENT template must drive the same stage immediately.
  await selectTemplate(page, "dialogue_ots_a_to_b");
  await expect(page.getByTestId("footer-template")).toContainText("dialogue_ots_a_to_b v1");
  snapshot = await waitForSnapshot(
    page,
    (s) => s.view === "camera" && positionEquals(s.activeCamera.position, OTS_A_TO_B_CAMERA),
  );
  expect(snapshot.activeCamera.fovDeg).toBeCloseTo(VFOV_75MM_169, 6);
  expect(snapshot.mannequins).toEqual(["character_a", "character_b"]);
});

test("simple controls update the camera view immediately through canonical state", async ({
  page,
}) => {
  await page.goto("/");
  await selectTemplate(page, "dialogue_medium_two_shot");
  await page.getByTestId("view-toggle-camera").click();
  const initial = await waitForSnapshot(page, (s) => s.view === "camera");
  expect(positionEquals(initial.activeCamera.position, MEDIUM_CAMERA)).toBe(true);
  const initialTargetDistance = Math.hypot(
    0 - initial.activeCamera.position[0],
    1.55 - initial.activeCamera.position[1],
    0 - initial.activeCamera.position[2],
  );

  await page.getByTestId("control-closer").click();
  const closer = await waitForSnapshot(
    page,
    (s) => !positionEquals(s.activeCamera.position, MEDIUM_CAMERA),
  );
  // 20% closer along the current position->target geometry; target unchanged.
  expect(closer.activeCamera.position[0]).toBeCloseTo(0, 6);
  expect(closer.activeCamera.position[1]).toBeCloseTo(1.59, 6);
  expect(closer.activeCamera.position[2]).toBeCloseTo(2.72, 6);
  const closerDistance = Math.hypot(
    0 - closer.activeCamera.position[0],
    1.55 - closer.activeCamera.position[1],
    0 - closer.activeCamera.position[2],
  );
  expect(closerDistance).toBeCloseTo(initialTargetDistance * 0.8, 6);

  await page.getByTestId("control-farther").click();
  const farther = await waitForSnapshot(
    page,
    (s) => !positionEquals(s.activeCamera.position, closer.activeCamera.position),
  );
  expect(farther.activeCamera.position[2]).toBeCloseTo(3.264, 6);

  // Emphasis re-aims the target at the CURRENT character transforms
  // (character_b stands at x=0.8; the target blends halfway to x=0.4).
  // The camera POSITION stays put — the view DIRECTION is what changes.
  await page.getByTestId("control-emphasize-b").click();
  const emphasized = await waitForSnapshot(
    page,
    (s) =>
      !positionEquals(s.activeCamera.worldDirection, farther.activeCamera.worldDirection) &&
      positionEquals(s.activeCamera.position, farther.activeCamera.position),
  );
  const direction = emphasized.activeCamera.worldDirection;
  const toTarget = [
    0.4 - emphasized.activeCamera.position[0],
    1.55 - emphasized.activeCamera.position[1],
    0 - emphasized.activeCamera.position[2],
  ];
  const toTargetLength = Math.hypot(toTarget[0], toTarget[1], toTarget[2]);
  expect(direction[0]).toBeCloseTo(toTarget[0] / toTargetLength, 4);
  expect(direction[1]).toBeCloseTo(toTarget[1] / toTargetLength, 4);
  expect(direction[2]).toBeCloseTo(toTarget[2] / toTargetLength, 4);

  // Focal feel preset changes the rendered FOV through the film-gate math.
  await page.getByTestId("control-focal-portrait").click();
  const portrait = await waitForSnapshot(
    page,
    (s) => Math.abs(s.activeCamera.fovDeg - VFOV_50MM_169) < 1e-6,
  );
  expect(portrait.activeCamera.fovDeg).toBeCloseTo(VFOV_50MM_169, 6);
});

test("aspect ratio switches between 16:9 and 9:16 with the correct film gates", async ({
  page,
}) => {
  await page.goto("/");
  await selectTemplate(page, "dialogue_ots_a_to_b"); // 75mm, 16:9
  await page.getByTestId("view-toggle-camera").click();
  const wide = await waitForSnapshot(page, (s) => s.view === "camera");
  expect(wide.activeCamera.fovDeg).toBeCloseTo(VFOV_75MM_169, 6); // 20.25mm vertical gate
  expect(wide.drawingBuffer.width / wide.drawingBuffer.height).toBeCloseTo(16 / 9, 1);
  await expect(page.getByTestId("footer-camera")).toContainText("16:9");

  await page.getByTestId("control-aspect-916").click();
  // Wait for BOTH the 36mm vertical gate FOV and the canvas actually resized
  // to the tall ratio (the canvas resize lands one layout pass later).
  const tall = await waitForSnapshot(
    page,
    (s) =>
      Math.abs(s.activeCamera.fovDeg - VFOV_75MM_916) < 1e-6 &&
      Math.abs(s.drawingBuffer.width / s.drawingBuffer.height - 9 / 16) < 0.05,
  );
  expect(tall.activeCamera.fovDeg).toBeCloseTo(VFOV_75MM_916, 6); // 36mm vertical gate
  expect(tall.drawingBuffer.width / tall.drawingBuffer.height).toBeCloseTo(9 / 16, 1);
  await expect(page.getByTestId("footer-camera")).toContainText("9:16");

  await page.getByTestId("control-aspect-169").click();
  await waitForSnapshot(
    page,
    (s) =>
      Math.abs(s.activeCamera.fovDeg - VFOV_75MM_169) < 1e-6 &&
      Math.abs(s.drawingBuffer.width / s.drawingBuffer.height - 16 / 9) < 0.05,
  );
});

test("advanced refinement is collapsed by default and expands on demand", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("advanced-refinement")).toBeHidden(); // no state yet
  await selectTemplate(page, "dialogue_ots_a_to_b");
  const refinement = page.getByTestId("advanced-refinement");
  await expect(refinement).toBeAttached();
  await expect(refinement).not.toHaveAttribute("open");
  await expect(refinement.getByTestId("input-camera-position-x")).toBeHidden();

  await refinement.locator("summary").click();
  await expect(refinement).toHaveAttribute("open");
  await expect(refinement.getByTestId("input-camera-position-x")).toBeVisible();
});

test("constrained transforms update the canonical ShotState and the 3D preview", async ({
  page,
}) => {
  await page.goto("/");
  await selectTemplate(page, "dialogue_ots_a_to_b");
  await page.getByTestId("view-toggle-camera").click();
  await waitForSnapshot(page, (s) => s.view === "camera");

  const posX = page.getByTestId("input-camera-position-x");
  // The advanced panel is collapsed; expand it first.
  await page.getByTestId("advanced-refinement").locator("summary").click();
  await expect(posX).toBeVisible();
  await expect(posX).toHaveValue("-1.25");

  // Every constrained input displays its unit and its exact numeric range
  // (the same values the commands clamp to).
  await expect(page.getByTestId("input-camera-position-x-range")).toHaveText("m · -2.9–2.9");
  await expect(page.getByTestId("input-camera-position-y-range")).toHaveText("m · 0.3–2.7");
  await expect(page.getByTestId("input-camera-position-z-range")).toHaveText("m · -2.4–4.4");
  await expect(page.getByTestId("input-camera-target-x-range")).toHaveText("m · -2.9–2.9");
  await expect(page.getByTestId("input-camera-target-z-range")).toHaveText("m · -2.4–4.4");
  await expect(page.getByTestId("input-camera-focal-length-range")).toHaveText(
    "mm · 12–200（Schema 范围）",
  );
  await expect(page.getByTestId("input-character_a-position-x-range")).toHaveText("m · -2.7–2.7");
  await expect(page.getByTestId("input-character_a-position-z-range")).toHaveText("m · -2.2–4.2");
  await expect(page.getByTestId("input-character_b-yaw-range")).toHaveText(
    "° · -180–180（自动归一）",
  );
  await expect(posX).toHaveAttribute("aria-label", "位置 x（单位 m，允许范围 -2.9 至 2.9）");
  // NEGATIVE: no constrained input exists without a unit + range annotation.
  const unannotated = await page
    .locator(".number-field")
    .evaluateAll(
      (nodes) =>
        (nodes as HTMLElement[]).filter(
          (node) =>
            node.querySelector(".number-field-range") === null ||
            !/^(m|mm|°) · -?\d/.test(node.querySelector(".number-field-range")!.textContent ?? ""),
        ).length,
    );
  expect(unannotated).toBe(0);

  await posX.fill("1.5");
  const moved = await waitForSnapshot(
    page,
    (s) => Math.abs(s.activeCamera.position[0] - 1.5) < 1e-6,
  );
  expect(moved.activeCamera.position[0]).toBeCloseTo(1.5, 6);

  // Out-of-range values are clamped to the provisional engineering box.
  await posX.fill("999");
  await waitForSnapshot(page, (s) => Math.abs(s.activeCamera.position[0] - 2.9) < 1e-6);
  await expect(posX).toHaveValue("2.9");
  await expect(page.getByTestId("footer-camera")).toContainText("2.90");

  // Focal length input clamps to the Schema range (500 -> 200mm).
  const focal = page.getByTestId("input-camera-focal-length");
  await focal.fill("500");
  await waitForSnapshot(page, (s) => Math.abs(s.activeCamera.fovDeg - 5.796249337657643) < 1e-4);
  await expect(focal).toHaveValue("200");

  // Character transforms write the same canonical state (director view shows it).
  await page.getByTestId("view-toggle-director").click();
  await waitForReadyView(page, "director");
  await page.getByTestId("input-character_a-position-x").fill("-1.5");
  await page.getByTestId("input-character_b-yaw").fill("270");
  await expect(page.getByTestId("footer-characters")).toContainText("-1.50");
  await expect(page.getByTestId("footer-characters")).toContainText("-90°");
});

test("reset restores the template values while keeping the session ShotState ID", async ({
  page,
}) => {
  await page.goto("/");
  await selectTemplate(page, "dialogue_ots_a_to_b");
  await page.getByTestId("view-toggle-camera").click();
  await waitForSnapshot(page, (s) => s.view === "camera");
  const idBefore = await page.getByTestId("footer-shot-state").textContent();

  await page.getByTestId("control-closer").click();
  await page.getByTestId("control-focal-compressed").click();
  await page.getByTestId("control-aspect-916").click();
  await waitForSnapshot(page, (s) => Math.abs(s.activeCamera.fovDeg - VFOV_75MM_916) > 1e-6);
  await expect(page.getByTestId("footer-camera")).toContainText("85mm");

  await page.getByTestId("control-reset").click();
  await waitForSnapshot(page, (s) => Math.abs(s.activeCamera.fovDeg - VFOV_75MM_169) < 1e-6);
  expect(positionEquals((await readSnapshot(page)).activeCamera.position, OTS_A_TO_B_CAMERA)).toBe(
    true,
  );
  await expect(page.getByTestId("footer-camera")).toContainText(
    "camera [-1.25, 1.70, 2.00] → [0.80, 1.55, 0.00] · 75mm",
  );
  await expect(page.getByTestId("footer-camera")).toContainText("16:9");
  await expect(page.getByTestId("footer-shot-state")).toHaveText(idBefore ?? "");
});

test("a page refresh restores the same session and ShotState ID", async ({ page }) => {
  await page.goto("/");
  await selectTemplate(page, "dialogue_ots_a_to_b");
  await page.getByTestId("control-focal-portrait").click();
  await page.getByTestId("control-aspect-916").click();
  // This test stays in director view (full-width canvas), so assert through
  // the canonical-state footer instead of camera-view buffer geometry.
  await expect(page.getByTestId("footer-camera")).toContainText("50mm");
  await expect(page.getByTestId("footer-camera")).toContainText("9:16");
  const idBefore = await page.getByTestId("footer-shot-state").textContent();
  // The persisted claim is backed by a real write, not by hydration alone.
  await expect(page.getByTestId("footer-persisted")).toContainText("已保存到此浏览器");

  await page.reload();
  await expect(page.getByTestId("studio-workspace")).toBeVisible();
  await expect(page.getByTestId("footer-shot-state")).toHaveText(idBefore ?? "");
  await expect(page.getByTestId("footer-template")).toContainText("dialogue_ots_a_to_b v1");
  // Edited values survive the round trip, not just the template defaults.
  await expect(page.getByTestId("footer-camera")).toContainText("50mm");
  await expect(page.getByTestId("footer-camera")).toContainText("9:16");
  // The restored session reports as saved again — it literally came from
  // localStorage.
  await expect(page.getByTestId("footer-persisted")).toContainText("已保存到此浏览器");
});

test("selecting a template reports the local session as saved", async ({ page }) => {
  await page.goto("/");
  await selectTemplate(page, "dialogue_ots_a_to_b");
  await waitForReadyView(page, "director");
  await expect(page.getByTestId("footer-persisted")).toHaveText("已保存到此浏览器（localStorage）");
  // The footer claim is backed by an actual envelope in localStorage.
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_KEY);
  expect(stored).toContain("storyboard-director-session");
});

test("a disabled localStorage keeps the studio usable and reports unavailability", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("SecurityError: storage access is denied");
      },
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("studio-root")).toBeVisible();
  await selectTemplate(page, "dialogue_ots_a_to_b");
  await waitForReadyView(page, "director");
  await expect(page.getByTestId("footer-persisted")).toHaveText(
    "本地保存不可用；编辑仅保留在当前页面",
  );
  // Editing continues purely in memory (makeCloser moves the camera from
  // z=2.00 to z=1.60).
  await page.getByTestId("control-closer").click();
  await expect(page.getByTestId("footer-camera")).toContainText("1.60]");
});

test("a failing session write keeps editing alive and reports write_failed", async ({ page }) => {
  await page.addInitScript((key) => {
    const storage = window.localStorage;
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (name: string, value: string) => {
      // The availability probe (a different key) passes; only the real
      // session key fails, e.g. quota exhausted.
      if (name === key) {
        throw new Error("QuotaExceededError");
      }
      originalSetItem(name, value);
    };
  }, SESSION_KEY);
  await page.goto("/");
  await selectTemplate(page, "dialogue_ots_a_to_b");
  await waitForReadyView(page, "director");
  await expect(page.getByTestId("footer-persisted")).toHaveText(
    "本地保存失败；编辑仍保留在当前页面",
  );
  await page.getByTestId("control-closer").click();
  await expect(page.getByTestId("footer-camera")).toContainText("1.60]");
});

test("no hydration warnings across load, edit and reload", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydrat|did not match|minified react error/i.test(message.text())
    ) {
      problems.push(message.text());
    }
  });
  page.on("pageerror", (error) => problems.push(String(error)));
  await page.goto("/");
  await selectTemplate(page, "dialogue_ots_a_to_b");
  await waitForReadyView(page, "director");
  await expect(page.getByTestId("footer-persisted")).toContainText("已保存到此浏览器");
  await page.reload();
  await expect(page.getByTestId("studio-workspace")).toBeVisible();
  await expect(page.getByTestId("footer-persisted")).toContainText("已保存到此浏览器");
  expect(problems).toEqual([]);
});

test("malformed persisted sessions fall back safely without crashing", async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "{ this is not valid session json");
  }, SESSION_KEY);
  await page.goto("/");
  await expect(page.getByTestId("studio-root")).toBeVisible();
  await expect(page.getByTestId("studio-empty")).toContainText("尚未选择模板");
  // The unusable data is cleaned up instead of being re-parsed forever.
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_KEY);
  expect(stored).toBeNull();

  // The studio still works normally afterwards.
  await selectTemplate(page, "dialogue_ots_a_to_b");
  await waitForReadyView(page, "director");
});

test("version-mismatched persisted sessions fall back safely", async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        kind: "storyboard-director-session",
        version: 99,
        shotState: { id: "future" },
      }),
    );
  }, SESSION_KEY);
  await page.goto("/");
  await expect(page.getByTestId("studio-root")).toBeVisible();
  await expect(page.getByTestId("studio-empty")).toContainText("尚未选择模板");
});

test("director and camera views keep their Prompt 3 semantics inside the studio", async ({
  page,
}) => {
  await page.goto("/");
  await selectTemplate(page, "dialogue_ots_a_to_b");

  const director = await waitForSnapshot(page, (s) => s.view === "director");
  expect(director.mannequins).toEqual(["character_a", "character_b"]);
  expect(director.shotCameraInScene).toBe(true);
  expect(director.frustumHelperVisible).toBe(true);
  expect(director.activeCamera.name).toBe("director-inspection-camera");

  await page.getByTestId("view-toggle-camera").click();
  const camera = await waitForSnapshot(page, (s) => s.view === "camera");
  expect(camera.activeCamera.name).toBe("shot-camera");
  expect(positionEquals(camera.activeCamera.position, OTS_A_TO_B_CAMERA)).toBe(true);
  expect(camera.activeCamera.fovDeg).toBeCloseTo(VFOV_75MM_169, 6);
  expect(camera.frustumHelperVisible).toBe(false);
  expect(camera.shotCameraInScene).toBe(false);
});

test("the studio workflow makes no external network requests", async ({ page }) => {
  const externalRequests = startExternalRequestLog(page);
  await page.goto("/");
  await selectTemplate(page, "dialogue_medium_two_shot");
  await waitForReadyView(page, "director");
  await page.getByTestId("control-closer").click();
  await page.getByTestId("control-focal-portrait").click();
  await page.getByTestId("control-aspect-916").click();
  await page.getByTestId("view-toggle-camera").click();
  await waitForSnapshot(page, (s) => s.view === "camera");
  await page.getByTestId("advanced-refinement").locator("summary").click();
  await page.getByTestId("input-camera-target-x").fill("0");
  await page.getByTestId("control-reset").click();
  await waitForReadyView(page, "camera");
  await page.reload();
  await expect(page.getByTestId("studio-workspace")).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("matches the committed studio visual baselines", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("template-gallery")).toBeVisible();
  const galleryImages = page.locator(".template-card-image-wrap img");
  await expect
    .poll(async () =>
      galleryImages.evaluateAll((nodes) =>
        (nodes as HTMLImageElement[]).every((node) => node.naturalWidth > 0),
      ),
    )
    .toBe(true);
  // DOM+image gallery area: deterministic at the fixed 1280px layout.
  await expect(page.getByTestId("template-gallery")).toHaveScreenshot({
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
  });

  await selectTemplate(page, "dialogue_ots_a_to_b");
  await waitForReadyView(page, "director");
  const stagePane = page.locator(".studio-stage-pane");
  // The ShotState ID (unique per load) is masked; everything else is static.
  await expect(stagePane).toHaveScreenshot({
    animations: "disabled",
    mask: [page.getByTestId("footer-shot-state")],
    maxDiffPixelRatio: 0.01,
  });

  await page.getByTestId("view-toggle-camera").click();
  await waitForSnapshot(page, (s) => s.view === "camera");
  await expect(stagePane).toHaveScreenshot({
    animations: "disabled",
    mask: [page.getByTestId("footer-shot-state")],
    maxDiffPixelRatio: 0.01,
  });
});

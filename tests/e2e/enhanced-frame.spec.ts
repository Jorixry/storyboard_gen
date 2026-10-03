import { expect, test, type Page } from "@playwright/test";

/**
 * Browser evidence for the enhanced first frame (Prompt 7B1 / Phase 2 Day 8
 * fallback: mock path + failure handling). Proves the explicit-action
 * contract, the deterministic mock result, zero external network usage and —
 * the Day 8 acceptance line — that raw export stays fully usable after an
 * enhanced-frame failure. The collapsed <details> gate must hide the action
 * until the user opens it.
 */

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

async function selectFirstTemplate(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("studio-root")).toBeVisible();
  await page.getByTestId("select-template-dialogue_medium_two_shot").click();
  await expect(page.getByTestId("studio-workspace")).toBeVisible();
}

async function openEnhancedFrame(page: Page): Promise<void> {
  const details = page.getByTestId("enhanced-frame");
  await expect(details).toBeVisible();
  // The panel is collapsed by default: the generate action must be hidden.
  await expect(page.getByTestId("generate-enhanced-frame")).toBeHidden();
  await details.locator("summary").click();
  await expect(page.getByTestId("generate-enhanced-frame")).toBeVisible();
}

test("enhanced frame is collapsed by default and generates only on the explicit action", async ({
  page,
}) => {
  const externalRequests = startExternalRequestLog(page);
  await selectFirstTemplate(page);
  await openEnhancedFrame(page);

  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/enhanced-frame") && response.status() === 200,
  );
  await page.getByTestId("generate-enhanced-frame").click();
  const response = await responsePromise;
  expect(response.request().method()).toBe("POST");

  const image = page.getByTestId("enhanced-frame-image");
  await expect(image).toBeVisible({ timeout: 15_000 });
  const src = await image.getAttribute("src");
  expect(src).toMatch(/^data:image\/svg\+xml;base64,/);
  await expect(page.getByTestId("enhanced-frame-provider")).toContainText(
    "mock-image-generation@1.0.0",
  );
  await expect(page.getByTestId("enhanced-frame-provider")).toContainText("provider=mock");
  // Unchanged current state: the result is fresh (not stale) and records its
  // source shot for provenance.
  await expect(page.getByTestId("enhanced-frame-result")).toHaveAttribute("data-stale", "false");
  await expect(page.getByTestId("enhanced-frame-result-stale")).toBeHidden();
  await expect(page.getByTestId("enhanced-frame-provider")).toContainText("generated from shot");
  await expect(page.getByTestId("enhanced-frame-error")).toBeHidden();

  expect(externalRequests).toEqual([]);
});

test("an enhanced-frame failure is retryable and never blocks raw export", async ({ page }) => {
  await selectFirstTemplate(page);
  await openEnhancedFrame(page);

  // First attempt: the enhanced-frame request fails at the network layer.
  await page.route("**/api/enhanced-frame", (route) => route.abort());
  await page.getByTestId("generate-enhanced-frame").click();
  const error = page.getByTestId("enhanced-frame-error");
  await expect(error).toBeVisible({ timeout: 15_000 });
  await expect(error).toContainText("可重试");
  await expect(page.getByTestId("enhanced-frame-result")).toBeHidden();
  await expect(page.getByTestId("enhanced-frame-image")).toBeHidden();

  // Raw export remains fully usable in the exact same session after the failure.
  const download = page.waitForEvent("download");
  await page.getByTestId("export-raw-zip").click();
  const archive = await download;
  expect(archive.suggestedFilename()).toMatch(/^shot-.+-raw\.zip$/);

  // Retry after unblocking the route succeeds — failure state is not sticky.
  await page.unroute("**/api/enhanced-frame");
  await page.getByTestId("generate-enhanced-frame").click();
  await expect(page.getByTestId("enhanced-frame-image")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("enhanced-frame-error")).toBeHidden();
});

test("a structured provider error surfaces in the UI", async ({ page }) => {
  await selectFirstTemplate(page);
  await openEnhancedFrame(page);

  // The realistic production-path error after 7B2: a provider is selected on
  // the server but its credential is missing (503 provider_credentials_missing).
  await page.route("**/api/enhanced-frame", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "provider_credentials_missing",
        message:
          'IMAGE_PROVIDER="seedream" is selected but ARK_API_KEY is not set on the server; set it in .env.local and restart, or switch IMAGE_PROVIDER=mock',
      }),
    }),
  );
  await page.getByTestId("generate-enhanced-frame").click();
  const error = page.getByTestId("enhanced-frame-error");
  await expect(error).toBeVisible({ timeout: 15_000 });
  // The UI surfaces the server's human-readable message verbatim; the machine
  // error code is asserted against the same handler in the unit contract tests.
  await expect(error).toContainText("ARK_API_KEY");
  await expect(error).toContainText("IMAGE_PROVIDER");
});

// ---------------------------------------------------------------------------
// Result provenance and staleness (acceptance fix round 2026-09-23, P2-1).
// Adapted from the review probe tests/e2e/review-prompt7.spec.ts: the browser
// case accepts an EXPLICIT stale marker over hiding the image, per the fix
// instructions.
// ---------------------------------------------------------------------------

test("switching templates marks the previous enhanced frame as stale with its source", async ({
  page,
}) => {
  await selectFirstTemplate(page);
  await openEnhancedFrame(page);
  await page.getByTestId("generate-enhanced-frame").click();
  const image = page.getByTestId("enhanced-frame-image");
  await expect(image).toBeVisible({ timeout: 15_000 });
  const previousSrc = await image.getAttribute("src");

  await page.getByTestId("select-template-dialogue_ots_a_to_b").click();
  await expect(page.getByTestId("footer-template")).toContainText("dialogue_ots_a_to_b");

  // The old image may remain readable for inspection, but it must be marked
  // stale with its source — never presented as the current shot's valid frame.
  const result = page.getByTestId("enhanced-frame-result");
  await expect(result).toHaveAttribute("data-stale", "true");
  await expect(page.getByTestId("enhanced-frame-result-stale")).toBeVisible();
  await expect(page.getByTestId("enhanced-frame-result-stale")).toContainText("已过期");
  await expect(page.getByTestId("enhanced-frame-result-stale")).toContainText(
    "dialogue_medium_two_shot",
  );
  await expect(image.getAttribute("src")).resolves.toBe(previousSrc);
  await expect(image).toHaveAttribute("alt", "增强首帧（已过期）");
});

test("editing a parameter under the SAME shot id also invalidates the result", async ({ page }) => {
  await selectFirstTemplate(page);
  await openEnhancedFrame(page);
  await page.getByTestId("generate-enhanced-frame").click();
  await expect(page.getByTestId("enhanced-frame-image")).toBeVisible({ timeout: 15_000 });
  const providerLineBefore = await page.getByTestId("enhanced-frame-provider").textContent();
  const shotId = (providerLineBefore ?? "").match(/generated from shot (\S+)/)?.[1];
  expect(shotId).toBeTruthy();

  // A simple-control edit mutates camera state in place — the ShotState id is
  // unchanged, so only a full-state fingerprint can detect the mismatch.
  await page.getByTestId("control-closer").click();

  await expect(page.getByTestId("enhanced-frame-result")).toHaveAttribute("data-stale", "true");
  await expect(page.getByTestId("enhanced-frame-result-stale")).toBeVisible();
  // Proof that the id stayed the same while the staleness flipped.
  const providerLineAfter = await page.getByTestId("enhanced-frame-provider").textContent();
  expect(providerLineAfter).toContain(`generated from shot ${shotId}`);
});

test("a late-arriving result for an edited state is stale from the moment it lands", async ({
  page,
}) => {
  await selectFirstTemplate(page);
  await openEnhancedFrame(page);

  // Delay the API response so the shot state changes while the request is in
  // flight; fulfill with a valid mock-shaped payload (tiny 1x1 PNG).
  const tinyPng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  await page.route("**/api/enhanced-frame", async (route) => {
    await page.waitForTimeout(400);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        imageBase64: tinyPng,
        imageMimeType: "image/png",
        adapterId: "mock-image-generation",
        adapterVersion: "1.0.0",
        provider: "mock",
        metadata: { delayed: "true" },
      }),
    });
  });

  await page.getByTestId("generate-enhanced-frame").click();
  // The state changes while the generation request is pending.
  await page.getByTestId("control-closer").click();

  const result = page.getByTestId("enhanced-frame-result");
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(result).toHaveAttribute("data-stale", "true");
  await expect(page.getByTestId("enhanced-frame-result-stale")).toBeVisible();
  await expect(page.getByTestId("enhanced-frame-image")).toHaveAttribute(
    "alt",
    "增强首帧（已过期）",
  );
});

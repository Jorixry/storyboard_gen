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

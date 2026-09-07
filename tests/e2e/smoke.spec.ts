import { expect, test } from "@playwright/test";

/**
 * Home smoke checks for the Prompt 4 studio. The scaffold-era notice text
 * ("Deterministic application scaffold") was replaced by the template
 * gallery workspace; the development labeling must stay visible.
 */
test("home page renders the development template gallery", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Storyboard Director MVP — 导演工作台" }),
  ).toBeVisible();
  await expect(page.getByTestId("gallery-development-note")).toContainText("DEVELOPMENT GALLERY");
  await expect(page.getByTestId("template-card")).toHaveCount(3);
  await expect(page.getByTestId("studio-empty")).toBeVisible();
});

test("home page makes no external network requests", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      externalRequests.push(request.url());
    }
  });
  await page.goto("/");
  await expect(page.getByTestId("template-card")).toHaveCount(3);
  expect(externalRequests).toEqual([]);
});

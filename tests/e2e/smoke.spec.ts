import { expect, test } from "@playwright/test";

test("home page renders the scaffold notice", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Storyboard Director MVP" })).toBeVisible();
  await expect(page.getByText("Deterministic application scaffold")).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Storyboard Director MVP" })).toBeVisible();
  expect(externalRequests).toEqual([]);
});

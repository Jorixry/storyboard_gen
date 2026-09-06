import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-test foundation. Latest desktop Chrome only, per MVP decision D011.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Headless WebGL scenes under full parallelism need headroom beyond the
  // 30s default; the readiness gate waits for the correct active camera.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

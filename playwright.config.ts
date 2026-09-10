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
  // Stability mitigation after the Prompt 6 acceptance round-1 timeouts at
  // download.saveAs. Working hypothesis: uncapped workers run several
  // software-WebGL Chromiums at once and, on a cold, contended machine, the
  // heaviest export tests exhaust their budget. The original failure was NOT
  // directly reproduced locally (renderer-starvation, parallel-download and
  // CPU-saturation probes all completed), so this is a contention-reducing
  // mitigation — not a proven root cause — chosen over retries, looser
  // tolerances or higher timeouts.
  workers: 2,
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

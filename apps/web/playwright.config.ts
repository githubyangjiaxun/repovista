import { defineConfig, devices } from "@playwright/test";

const webOrigin = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const continuousIntegration = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: continuousIntegration,
  retries: continuousIntegration ? 2 : 0,
  // A single dev server is intentionally shared by all browser journeys. This avoids
  // hydration/compilation races in Next development mode while CI remains deterministic.
  workers: 1,
  reporter: continuousIntegration
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL: webOrigin,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    command: "pnpm exec next dev --hostname 127.0.0.1 --port 3100",
    env: {
      NEXT_PUBLIC_API_ORIGIN: "http://localhost:4000",
    },
    reuseExistingServer: !continuousIntegration,
    timeout: 120_000,
    url: webOrigin,
  },
});

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3200";
const local = !process.env.BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  use: { baseURL: BASE_URL, locale: "en-US", timezoneId: "America/New_York", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", testIgnore: /owner-link/, use: { browserName: "chromium", viewport: { width: 1360, height: 900 } } },
    { name: "owner-link-mobile", testMatch: /owner-link/, use: { ...devices["Pixel 7"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
  ],
  webServer: local
    ? {
        command: "npx next start -p 3200",
        url: "http://localhost:3200",
        reuseExistingServer: true,
        env: {
          DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://localhost/dl_e2e",
          APP_URL: "http://localhost:3200",
          PLAYWRIGHT_LOCAL: "1",
        },
      }
    : undefined,
});

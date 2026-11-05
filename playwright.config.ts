import { defineConfig, devices } from "@playwright/test";

const chrome = process.env.CHROME_PATH;

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    launchOptions: chrome ? { executablePath: chrome } : {},
  },
  projects: [
    { name: "iPhone", use: { ...devices["iPhone 15"], browserName: "chromium", defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "npm run db:migrate:local && npm run dev -- --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

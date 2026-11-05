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
    // 偽のマイク（Chrome 内蔵のテスト用音声）で録音を検証する
    launchOptions: {
      ...(chrome ? { executablePath: chrome } : {}),
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
    permissions: ["microphone"],
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

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "playwright/test";

const dataRoot = mkdtempSync(join(tmpdir(), "pr0-browser-tests-"));
const apiPort = 5013;
const webPort = 5179;
process.env.PR0_BROWSER_TEST_ROOT = dataRoot;

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: join(dataRoot, "artifacts"),
  globalTeardown: "./tests/browser/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${webPort}`,
    browserName: "chromium",
    headless: true
  },
  webServer: [
    {
      command: "npm run dev -w @pr-0/server",
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(apiPort),
        FRONTEND_ORIGIN: `http://localhost:${webPort}`,
        DATABASE_URL: `file:${join(dataRoot, "browser.db")}`,
        PR0_WORKSPACE_ROOT: process.cwd()
      }
    },
    {
      command: `npm run dev -w @pr-0/web -- --host 127.0.0.1 --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { PR0_WEB_API_TARGET: `http://127.0.0.1:${apiPort}` }
    }
  ]
});

import { defineConfig } from "@playwright/test";
import community from "./playwright.config";

// Theme checks only browse pages and change browser preferences; they can share
// an existing isolated test server without resetting its business fixtures.
export default defineConfig({
  ...community,
  testMatch: "theme.spec.ts",
  outputDir: "test-results-ui",
  webServer: {
    command: "node node_modules/tsx/dist/cli.mjs scripts/e2e-server.ts",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 120000,
  },
});

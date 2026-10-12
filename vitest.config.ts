import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve("src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    setupFiles: ["tests/setup.ts"],
    testTimeout: 20000,
    env: {
      DATABASE_URL: "file:./data/test-unit.db",
      STORAGE_DIR: "./data/test-files",
      PROJECT_TEMP_DIR: "./data/test-project-tasks",
      BETTER_AUTH_SECRET: "unit-test-secret-must-be-at-least-thirty-two-characters",
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
    },
  },
});

import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { startMockGitHub } from "./mock-github";
const root = path.resolve("data/e2e");
if (!root.startsWith(path.resolve("data") + path.sep)) throw new Error("测试目录无效");
mkdirSync(root, { recursive: true });
const connection = new Database(path.join(root, "community.db"));
const tables = connection
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all() as { name: string }[];
connection.pragma("foreign_keys = OFF");
for (const table of tables) connection.exec(`DROP TABLE "${table.name.replaceAll('"', '""')}"`);
for (const folder of readdirSync("prisma/migrations")
  .filter((name) => /^\d/.test(name))
  .sort())
  connection.exec(readFileSync(`prisma/migrations/${folder}/migration.sql`, "utf8"));
connection.close();
const github = await startMockGitHub();
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const testKeyPath = path.join(root, "github-test.pem");
writeFileSync(testKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
writeFileSync(path.join(root, "mock-github.json"), JSON.stringify({ url: github.url }));
const env = {
  ...process.env,
  E2E_RUN: "true",
  NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_URL: "file:./data/e2e/community.db",
  STORAGE_DIR: "./data/e2e/files",
  PROJECT_TEMP_DIR: "./data/e2e/project-tasks",
  GITHUB_ORGANIZATION: "zhiye-test",
  GITHUB_APP_ID: "1",
  GITHUB_INSTALLATION_ID: "1",
  GITHUB_PRIVATE_KEY_PATH: testKeyPath,
  GITHUB_TEST_API_URL: github.url,
  BETTER_AUTH_URL: "http://127.0.0.1:3100",
  BETTER_AUTH_SECRET: "isolated-e2e-secret-at-least-thirty-two-characters",
  INITIAL_ADMIN_EMAIL: "admin-e2e@example.test",
  INITIAL_ADMIN_PASSWORD: "InitialAdminTest123!",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
};
const pdfAssets = spawnSync(process.execPath, ["scripts/prepare-pdf.mjs"], {
  env,
  stdio: "inherit",
});
if (pdfAssets.status !== 0) process.exit(1);
mkdirSync(path.join(root, "files"), { recursive: true });
const seed = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/seed.ts"], {
  env,
  stdio: "inherit",
});
if (seed.status !== 0) process.exit(1);
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--port", "3100", "--hostname", "127.0.0.1"],
  { env, stdio: "inherit", windowsHide: true },
);
const worker = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "scripts/project-worker.ts"],
  {
    env,
    stdio: "inherit",
    windowsHide: true,
  },
);
let shuttingDown = false;
async function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  child.kill("SIGTERM");
  worker.kill("SIGTERM");
  await github.close();
  process.exit(code);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void shutdown(0));
child.on("exit", (code) => void shutdown(code || 0));
worker.on("exit", (code) => {
  if (!shuttingDown) void shutdown(code || 1);
});

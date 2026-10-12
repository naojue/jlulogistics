import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { config } from "dotenv";
import Database from "better-sqlite3";
mkdirSync("data/files", { recursive: true });
if (!existsSync(".env")) {
  const template = readFileSync(".env.example", "utf8");
  writeFileSync(
    ".env",
    template
      .replace(
        "replace-with-a-random-secret-at-least-32-characters",
        randomBytes(32).toString("hex"),
      )
      .replace("replace-with-a-strong-initial-password", randomBytes(18).toString("base64url")),
    { flag: "wx" },
  );
  console.log("已创建本地 .env；初始管理员邮箱和密码请在该文件中查看。");
}
config({ quiet: true });
const databaseFile = path.resolve(
  (process.env.DATABASE_URL || "file:./data/community.db").slice(5),
);
mkdirSync(path.dirname(databaseFile), { recursive: true });
new Database(databaseFile).close();
for (const args of [
  ["node_modules/prisma/build/index.js", "generate"],
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  ["node_modules/tsx/dist/cli.mjs", "scripts/seed.ts"],
]) {
  const result = spawnSync(
    process.execPath,
    args.map((arg, index) => (index === 0 ? path.resolve(arg) : arg)),
    { stdio: "inherit", env: process.env },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log("初始化完成。运行 npm run mail，再在另一个终端运行 npm run dev。");

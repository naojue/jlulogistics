import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

let folder: string;
const script = path.resolve("scripts/backup.ts");
beforeEach(() => {
  folder = mkdtempSync(path.resolve("data/test-backup-"));
  mkdirSync(path.join(folder, "files"));
  mkdirSync(path.join(folder, "project-tasks"));
  writeFileSync(path.join(folder, "files", "image.dat"), "image fixture");
  writeFileSync(path.join(folder, "project-tasks", "pending.zip"), "pending fixture");
});
afterEach(() => {
  if (path.dirname(folder) !== path.resolve("data"))
    throw new Error("Invalid isolated backup path");
  rmSync(folder, { recursive: true, force: true });
});
function database(projects = true) {
  const connection = new Database(path.join(folder, "community.db"));
  const migrations = readdirSync("prisma/migrations")
    .filter((name) => /^\d/.test(name))
    .sort();
  for (const name of migrations) {
    if (!projects && name.startsWith("20261011")) continue;
    connection.exec(readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8"));
  }
  return connection;
}
function backup() {
  return execFileSync(process.execPath, [script], {
    cwd: folder,
    env: {
      ...process.env,
      DATABASE_URL: `file:${path.join(folder, "community.db")}`,
      STORAGE_DIR: path.join(folder, "files"),
      PROJECT_TEMP_DIR: path.join(folder, "project-tasks"),
      BACKUP_APP_URL: "http://127.0.0.1:1",
      GITHUB_ORGANIZATION: "isolated-test",
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}
it("备份包含数据库、图片和待同步包，并从副本和源库移除维护租约", () => {
  const connection = database();
  connection.exec(`INSERT INTO "User" (id,name,email,updatedAt) VALUES ('u','测试','test@example.test',CURRENT_TIMESTAMP);
    INSERT INTO "Project" (id,title,description,course,authorId,repositoryName,updatedAt) VALUES ('p','项目','介绍','课程','u','zhiye-project-p',CURRENT_TIMESTAMP);
    INSERT INTO "ProjectVersion" (id,projectId,taskId,number,message,commitSha,fileCount,size) VALUES ('v','p','t',1,'版本','${"a".repeat(40)}',1,10);`);
  connection.close();
  expect(backup()).toContain("本地备份完成");
  const destination = path.join(folder, "backups", readdirSync(path.join(folder, "backups"))[0]);
  expect(readFileSync(path.join(destination, "files", "image.dat"), "utf8")).toBe("image fixture");
  expect(readFileSync(path.join(destination, "project-tasks", "pending.zip"), "utf8")).toBe(
    "pending fixture",
  );
  expect(existsSync(path.join(destination, "project-tasks", ".backup-lock"))).toBe(false);
  const inventory = JSON.parse(
    readFileSync(path.join(destination, "remote-projects.json"), "utf8"),
  );
  expect(inventory.versions[0].commitSha).toBe("a".repeat(40));
  expect(inventory.sourceFilesIncluded).toBe(false);
  for (const file of [path.join(folder, "community.db"), path.join(destination, "community.db")]) {
    const restored = new Database(file);
    expect(restored.prepare('SELECT count(*) AS count FROM "ProjectWorkerLease"').get()).toEqual({
      count: 0,
    });
    restored.close();
  }
  expect(existsSync(path.join(folder, "project-tasks", ".backup-lock"))).toBe(false);
});
it("有效worker租约阻止备份，已有维护锁不会被抢占或删除", () => {
  const connection = database();
  connection
    .prepare('INSERT INTO "ProjectWorkerLease" VALUES (?,?,?)')
    .run(
      "project-worker",
      "running",
      new Date(Date.now() + 60_000).toISOString().replace("Z", "+00:00"),
    );
  connection.close();
  try {
    backup();
    throw new Error("An active lease must block the backup");
  } catch (error) {
    expect((error as { status?: number }).status).toBe(75);
  }
  expect(existsSync(path.join(folder, "backups"))).toBe(false);
  const marker = path.join(folder, "project-tasks", ".backup-lock");
  expect(existsSync(marker)).toBe(false);
  writeFileSync(marker, "owned-by-another-backup");
  expect(() => backup()).toThrow();
  expect(readFileSync(marker, "utf8")).toBe("owned-by-another-backup");
});
it("升级前旧schema可备份；过期租约可接管；失败备份释放自己维护锁", () => {
  database(false).close();
  expect(backup()).toContain("本地备份完成");
  const connection = new Database(path.join(folder, "community.db"));
  connection.exec(
    readFileSync("prisma/migrations/20261011000000_projects_questions/migration.sql", "utf8"),
  );
  connection
    .prepare('INSERT INTO "ProjectWorkerLease" VALUES (?,?,?)')
    .run("project-worker", "crashed", new Date(0).toISOString().replace("Z", "+00:00"));
  connection.close();
  const files = path.resolve(folder, "files");
  if (!files.startsWith(path.resolve("data") + path.sep)) throw new Error("Invalid cleanup path");
  rmSync(files, { recursive: true });
  expect(() => backup()).toThrow();
  expect(existsSync(path.join(folder, "project-tasks", ".backup-lock"))).toBe(false);
  const current = new Database(path.join(folder, "community.db"));
  expect(current.prepare('SELECT count(*) AS count FROM "ProjectWorkerLease"').get()).toEqual({
    count: 0,
  });
  current.close();
});

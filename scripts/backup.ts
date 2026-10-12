import "dotenv/config";
import { mkdir, cp, writeFile, open, readFile, unlink, lstat } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
async function backup() {
  process.umask(0o077);
  const url = new URL(process.env.BACKUP_APP_URL || "http://127.0.0.1:3000");
  const running = await new Promise<boolean>((resolve) => {
    const socket = net.connect({
      host: url.hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
  });
  if (running)
    throw new Error("请先停止网站和项目同步服务，再执行备份，以保证数据库与文件的一致性。");
  const folder = path.resolve(
    "backups",
    new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-"),
  );
  const rawDatabase = process.env.DATABASE_URL || "file:./data/community.db";
  if (!rawDatabase.startsWith("file:")) throw new Error("备份仅支持 SQLite file: 数据库");
  const source = path.resolve(rawDatabase.slice(5));
  const projectDirectory = path.resolve(process.env.PROJECT_TEMP_DIR || "./data/project-tasks");
  await mkdir(projectDirectory, { recursive: true, mode: 0o700 });
  const markerPath = path.join(projectDirectory, ".backup-lock");
  const token = `backup-${randomUUID()}`;
  const marker = await open(markerPath, "wx", 0o600).catch(() => {
    throw new Error(
      "已有备份维护锁。请先确认另一次备份及项目同步服务已停止；不要强行清除正在使用的锁。",
    );
  });
  const markerIdentity = await marker.stat();
  let markerWritten = false;
  let connection: Database.Database | undefined;
  let leaseHeld = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lostLease = false;
  try {
    await marker.writeFile(
      JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() }),
    );
    markerWritten = true;
    await marker.close();
    connection = new Database(source, { fileMustExist: true });
    connection.pragma("busy_timeout = 5000");
    const hasTable = (name: string) =>
      !!connection!.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    if (hasTable("ProjectWorkerLease")) {
      const claim = connection.transaction(() => {
        const row = connection!
          .prepare('SELECT token, expiresAt FROM "ProjectWorkerLease" WHERE id=?')
          .get("project-worker") as { token: string; expiresAt: string | number } | undefined;
        const expires =
          row && (typeof row.expiresAt === "number" ? row.expiresAt : Date.parse(row.expiresAt));
        if (row && (!Number.isFinite(expires) || expires! > Date.now()))
          throw Object.assign(
            new Error(
              "项目同步服务仍有有效任务租约。请先停止 zhiye-project-worker；强制结束后最多等待两分钟再备份。",
            ),
            { exitCode: 75 },
          );
        connection!
          .prepare(
            'INSERT INTO "ProjectWorkerLease" (id, token, expiresAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET token=excluded.token, expiresAt=excluded.expiresAt',
          )
          .run(
            "project-worker",
            token,
            new Date(Date.now() + 120_000).toISOString().replace("Z", "+00:00"),
          );
      });
      claim.immediate();
      leaseHeld = true;
      timer = setInterval(() => {
        try {
          const updated = connection!
            .prepare('UPDATE "ProjectWorkerLease" SET expiresAt=? WHERE id=? AND token=?')
            .run(
              new Date(Date.now() + 120_000).toISOString().replace("Z", "+00:00"),
              "project-worker",
              token,
            );
          if (updated.changes !== 1) lostLease = true;
        } catch {
          lostLease = true;
        }
      }, 15_000);
      timer.unref();
    }
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await connection.backup(path.join(folder, "community.db"));
    // The maintenance lease is local runtime state, not something a restored worker should inherit.
    if (leaseHeld) {
      const clone = new Database(path.join(folder, "community.db"));
      try {
        clone
          .prepare('DELETE FROM "ProjectWorkerLease" WHERE id=? AND token=?')
          .run("project-worker", token);
      } finally {
        clone.close();
      }
    }
    await cp(path.resolve(process.env.STORAGE_DIR || "./data/files"), path.join(folder, "files"), {
      recursive: true,
    });
    await cp(projectDirectory, path.join(folder, "project-tasks"), {
      recursive: true,
      filter: (entry) =>
        path.basename(entry) !== ".backup-lock" && path.basename(entry) !== ".quota-lock",
    });
    const remoteVersions =
      hasTable("Project") && hasTable("ProjectVersion")
        ? connection
            .prepare(
              'SELECT p.id AS projectId, p.repositoryName, v.number, v.commitSha, v.fileCount, v.size FROM "ProjectVersion" v JOIN "Project" p ON p.id=v.projectId ORDER BY p.id, v.number',
            )
            .all()
        : [];
    await writeFile(
      path.join(folder, "remote-projects.json"),
      JSON.stringify(
        {
          organization: process.env.GITHUB_ORGANIZATION || null,
          versions: remoteVersions,
          sourceFilesIncluded: false,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    if (lostLease) throw new Error("备份维护租约已失效，本次备份未完成，请重新备份。");
    const schema = hasTable("_prisma_migrations")
      ? (
          connection
            .prepare(
              'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1',
            )
            .get() as { migration_name: string } | undefined
        )?.migration_name
      : undefined;
    await writeFile(
      path.join(folder, "manifest.json"),
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          schema: schema || "unknown",
          database: "community.db",
          files: "files",
          pendingProjectUploads: "project-tasks",
          remoteProjectInventory: "remote-projects.json",
          remoteSourceFilesIncluded: false,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      "本地备份完成：" +
        folder +
        "。包含数据库、图片和待同步包；已发布的 GitHub 源码需另行备份。请另外保存 .env 与 GitHub App 私钥。",
    );
  } finally {
    if (timer) clearInterval(timer);
    if (connection) {
      try {
        if (leaseHeld)
          connection
            .prepare('DELETE FROM "ProjectWorkerLease" WHERE id=? AND token=?')
            .run("project-worker", token);
      } catch {
        console.error("备份维护租约未能立即释放，请确认服务停止并等待两分钟。");
      } finally {
        connection.close();
      }
    }
    await marker.close().catch(() => {});
    // Release only our own lock; a crashed run must be inspected before manual recovery.
    const current = await readFile(markerPath, "utf8").catch(() => null);
    const identity = await lstat(markerPath).catch(() => null);
    let owner: string | undefined;
    try {
      owner = current ? JSON.parse(current).token : undefined;
    } catch {
      /* A partial write is recovered only by its original owner. */
    }
    if (
      identity?.ino === markerIdentity.ino &&
      identity.dev === markerIdentity.dev &&
      (!markerWritten || owner === token)
    )
      await unlink(markerPath);
  }
}
backup().catch((error) => {
  console.error(error.message);
  process.exitCode = error.exitCode === 75 ? 75 : 1;
});

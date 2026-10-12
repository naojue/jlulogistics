import Database from "better-sqlite3";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

export class RecoveryError extends Error {}

function superAdmin(connection) {
  const users = connection.prepare('SELECT * FROM "User" WHERE role = ?').all("SUPER_ADMIN");
  if (users.length !== 1) throw new RecoveryError("必须恰好有一个超级管理员，未修改数据库。");
  const user = users[0];
  if (user.status !== "ACTIVE" || user.emailVerified !== 1)
    throw new RecoveryError("超级管理员当前不可用；本工具不会改变角色、状态或邮箱验证结果。");
  const accounts = connection
    .prepare('SELECT id FROM "Account" WHERE "userId" = ? AND "providerId" = ?')
    .all(user.id, "credential");
  if (accounts.length !== 1)
    throw new RecoveryError("超级管理员的密码账号不唯一或不存在，未修改数据库。");
  return { user, accountId: accounts[0].id };
}

/** Offline maintenance only. The caller must stop all application processes first. */
export async function resetSuperAdminPassword(databasePath, password, backupDirectory) {
  if (typeof password !== "string" || password.length < 10 || password.length > 128)
    throw new RecoveryError("新密码需要 10–128 位。");
  const filename = resolve(databasePath);
  try {
    if (!statSync(filename).isFile()) throw new Error();
  } catch {
    throw new RecoveryError("数据库文件不存在；不会创建新数据库。");
  }
  const connection = new Database(filename, { fileMustExist: true });
  connection.pragma("foreign_keys = ON");
  connection.pragma("busy_timeout = 5000");
  try {
    superAdmin(connection);
    const hashedPassword = await hashPassword(password);
    const folder = join(resolve(backupDirectory), `recovery-${Date.now()}-${randomUUID()}`);
    mkdirSync(resolve(backupDirectory), { recursive: true, mode: 0o700 });
    mkdirSync(folder, { mode: 0o700 });
    const backupPath = join(folder, "community.db");
    await connection.backup(backupPath);
    chmodSync(backupPath, 0o600);
    const result = connection
      .transaction(() => {
        // Recheck inside the write transaction; never trust an earlier role/state read.
        const { user, accountId } = superAdmin(connection);
        const now = new Date().toISOString().replace("Z", "+00:00");
        const changed = connection
          .prepare(
            'UPDATE "Account" SET password = ?, "updatedAt" = ? WHERE id = ? AND "userId" = ? AND "providerId" = ?',
          )
          .run(hashedPassword, now, accountId, user.id, "credential");
        if (changed.changes !== 1) throw new RecoveryError("密码账号发生变化，操作已回滚。");
        connection
          .prepare('UPDATE "User" SET "mustChangePassword" = 1, "updatedAt" = ? WHERE id = ?')
          .run(now, user.id);
        const sessions = connection
          .prepare('DELETE FROM "Session" WHERE "userId" = ?')
          .run(user.id);
        const resets = connection
          .prepare('DELETE FROM "Verification" WHERE value = ? AND identifier LIKE ?')
          .run(user.id, "reset-password:%");
        connection
          .prepare(
            'INSERT INTO "AuditLog" (id, "actorId", action, "targetId", reason, "createdAt") VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(
            randomUUID(),
            user.id,
            "OFFLINE_SUPER_ADMIN_PASSWORD_RESET",
            user.id,
            "服务器维护：离线恢复密码，撤销旧会话和密码重置链接，要求登录后改密。",
            now,
          );
        return {
          email: user.email,
          revokedSessions: sessions.changes,
          revokedResets: resets.changes,
        };
      })
      .immediate();
    return { ...result, backupPath };
  } finally {
    connection.close();
  }
}

let closePasswordInput = () => {};

async function hiddenPasswords() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new RecoveryError("请在服务器交互终端运行；不接受管道、命令参数或环境变量中的密码。");
  // Readline enables raw mode; discard its echo, history and terminal output.
  const silentOutput = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const input = createInterface({
    input: process.stdin,
    output: silentOutput,
    terminal: true,
    historySize: 0,
  });
  closePasswordInput = () => {
    input.close();
    process.stdin.pause();
    process.stdin.unref?.();
  };
  let cancelQuestion;
  // Keep raw mode until all asynchronous database work and final output complete.
  input.on("SIGINT", () => cancelQuestion?.());
  function question(prompt) {
    if (input.closed) throw new RecoveryError("已取消，未修改密码。");
    process.stdout.write(prompt);
    return new Promise((accept, reject) => {
      const canceled = () => {
        process.stdout.write("\n");
        reject(new RecoveryError("已取消，未修改密码。"));
      };
      cancelQuestion = canceled;
      input.once("close", canceled);
      input.question("", (answer) => {
        cancelQuestion = undefined;
        input.removeListener("close", canceled);
        process.stdout.write("\n");
        accept(answer);
      });
    });
  }
  const password = await question("输入临时新密码（10–128 位，输入不会显示）：");
  const repeated = await question("再次输入临时新密码：");
  if (password !== repeated) throw new RecoveryError("两次密码不一致，未修改数据库。");
  return password;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--database" || args[2] !== "--backup-dir")
    throw new RecoveryError("请通过 scripts/reset-super-admin-server.sh 运行此工具。");
  if (process.env.ZHIYE_RECOVERY_OFFLINE !== "1")
    throw new RecoveryError("请先使用维护脚本停止网站与项目进程。");
  const password = await hiddenPasswords();
  const result = await resetSuperAdminPassword(args[1], password, args[3]);
  console.log(`密码已重置。超级管理员邮箱：${result.email}`);
  console.log(`已撤销 ${result.revokedSessions} 个旧会话和 ${result.revokedResets} 个旧重置链接。`);
  console.log(`数据库备份：${result.backupPath}（不包含资料文件；无需恢复）。`);
  console.log("请使用临时新密码登录，然后在网站中修改密码。初始化配置不会覆盖本次设置。");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  function finish(status) {
    // A Windows console read can keep stdin alive after readline closes.
    // At this point all backup/write work is awaited and the database is closed.
    process.stdout.write("", () =>
      process.stderr.write("", () => {
        // Terminal teardown cannot change the completed database outcome or
        // expose a platform-specific stdin error after the result is printed.
        process.stdin.on("error", () => {});
        try {
          closePasswordInput();
        } catch {}
        process.exit(status);
      }),
    );
  }
  main().then(
    () => finish(0),
    (error) => {
      console.error(
        error instanceof RecoveryError
          ? error.message
          : "恢复失败，未输出底层错误。请检查磁盘、数据库权限和维护状态。",
      );
      finish(1);
    },
  );
}

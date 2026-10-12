import { afterEach, beforeEach, expect, test } from "vitest";
import Database from "better-sqlite3";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { resetSuperAdminPassword } from "../scripts/reset-super-admin.mjs";

let folder: string;
let filename: string;
let connection: Database.Database;
let originalPassword: string;
beforeEach(async () => {
  folder = mkdtempSync(resolve("data/test-account-recovery-"));
  filename = join(folder, "community.db");
  connection = new Database(filename);
  connection.pragma("foreign_keys = ON");
  for (const name of readdirSync("prisma/migrations")
    .filter((name) => /^\d/.test(name))
    .sort())
    connection.exec(readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8"));
  originalPassword = await hashPassword("old-password-fixture");
  for (const [id, role] of [
    ["super", "SUPER_ADMIN"],
    ["member", "MEMBER"],
  ]) {
    connection
      .prepare(
        'INSERT INTO "User" (id, name, email, role, status, "emailVerified", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, "测试账号", `${id}@example.test`, role, "ACTIVE", 1, new Date().toISOString());
    connection
      .prepare(
        'INSERT INTO "Account" (id, "accountId", "userId", "providerId", password, "updatedAt") VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, id, id, "credential", originalPassword, new Date().toISOString());
    connection
      .prepare(
        'INSERT INTO "Session" (id, token, "userId", "expiresAt", "updatedAt") VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        id,
        `${id}-session`,
        id,
        new Date(Date.now() + 60000).toISOString(),
        new Date().toISOString(),
      );
    connection
      .prepare(
        'INSERT INTO "Verification" (id, identifier, value, "expiresAt", "updatedAt") VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        id,
        `reset-password:${id}`,
        id,
        new Date(Date.now() + 60000).toISOString(),
        new Date().toISOString(),
      );
  }
  connection
    .prepare(
      'INSERT INTO "Verification" (id, identifier, value, "expiresAt", "updatedAt") VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      "unrelated",
      "email-verification:fixture",
      "super",
      new Date(Date.now() + 60000).toISOString(),
      new Date().toISOString(),
    );
});
afterEach(() => {
  connection.close();
  if (
    dirname(folder) !== resolve("data") ||
    !folder.startsWith(resolve("data/test-account-recovery-"))
  )
    throw new Error("Unsafe isolated test cleanup path");
  rmSync(folder, { recursive: true, force: true });
});

function account(id = "super") {
  return connection.prepare('SELECT password FROM "Account" WHERE id = ?').get(id) as {
    password: string;
  };
}
function user() {
  return connection
    .prepare('SELECT role, status, "emailVerified", "mustChangePassword" FROM "User" WHERE id = ?')
    .get("super");
}

test("恢复沿用 Better Auth 散列，备份旧密码，撤销自己的会话与重置链接，不改变成员或权限", async () => {
  const result = await resetSuperAdminPassword(
    filename,
    "new-password-fixture",
    join(folder, "backups"),
  );
  expect(await verifyPassword({ hash: account().password, password: "new-password-fixture" })).toBe(
    true,
  );
  expect(await verifyPassword({ hash: account().password, password: "old-password-fixture" })).toBe(
    false,
  );
  expect(result).toMatchObject({
    email: "super@example.test",
    revokedSessions: 1,
    revokedResets: 1,
  });
  expect(user()).toEqual({
    role: "SUPER_ADMIN",
    status: "ACTIVE",
    emailVerified: 1,
    mustChangePassword: 1,
  });
  expect(account("member").password).toBe(originalPassword);
  expect(connection.prepare('SELECT "userId" FROM "Session"').all()).toEqual([
    { userId: "member" },
  ]);
  expect(connection.prepare('SELECT id FROM "Verification" ORDER BY id').all()).toEqual([
    { id: "member" },
    { id: "unrelated" },
  ]);
  expect(connection.prepare('SELECT action, "actorId", "targetId" FROM "AuditLog"').get()).toEqual({
    action: "OFFLINE_SUPER_ADMIN_PASSWORD_RESET",
    actorId: "super",
    targetId: "super",
  });
  const backup = new Database(result.backupPath, { readonly: true, fileMustExist: true });
  try {
    expect(
      (
        backup.prepare('SELECT password FROM "Account" WHERE id = ?').get("super") as {
          password: string;
        }
      ).password,
    ).toBe(originalPassword);
    expect(backup.prepare('SELECT count(*) AS total FROM "Session"').get()).toEqual({ total: 2 });
  } finally {
    backup.close();
  }
});

test.each(["PENDING", "REJECTED", "SUSPENDED"])(
  "不会以密码恢复为由启用 %s 账号",
  async (status) => {
    connection.prepare('UPDATE "User" SET status = ? WHERE id = ?').run(status, "super");
    await expect(
      resetSuperAdminPassword(filename, "new-password-fixture", join(folder, "backups")),
    ).rejects.toThrow("不可用");
    expect(account().password).toBe(originalPassword);
    expect(existsSync(join(folder, "backups"))).toBe(false);
  },
);

test("拒绝未验证、多个超级管理员和缺失的密码账号", async () => {
  connection.prepare('UPDATE "User" SET "emailVerified" = 0 WHERE id = ?').run("super");
  await expect(
    resetSuperAdminPassword(filename, "new-password-fixture", join(folder, "backups")),
  ).rejects.toThrow("不可用");
  connection.prepare('UPDATE "User" SET "emailVerified" = 1 WHERE id = ?').run("super");
  connection.prepare('UPDATE "User" SET role = ? WHERE id = ?').run("SUPER_ADMIN", "member");
  await expect(
    resetSuperAdminPassword(filename, "new-password-fixture", join(folder, "backups")),
  ).rejects.toThrow("恰好");
  connection.prepare('UPDATE "User" SET role = ? WHERE id = ?').run("MEMBER", "member");
  connection.prepare('DELETE FROM "Account" WHERE id = ?').run("super");
  await expect(
    resetSuperAdminPassword(filename, "new-password-fixture", join(folder, "backups")),
  ).rejects.toThrow("密码账号");
});

test("不存在的数据库和失败的备份不会写入账号", async () => {
  const missing = join(folder, "missing.db");
  await expect(
    resetSuperAdminPassword(missing, "new-password-fixture", join(folder, "backups")),
  ).rejects.toThrow("不会创建");
  expect(existsSync(missing)).toBe(false);
  const blocked = join(folder, "not-a-directory");
  writeFileSync(blocked, "fixture");
  await expect(
    resetSuperAdminPassword(filename, "new-password-fixture", blocked),
  ).rejects.toThrow();
  expect(account().password).toBe(originalPassword);
  expect(connection.prepare('SELECT count(*) AS total FROM "Session"').get()).toEqual({ total: 2 });
});

test("审计写入失败时，密码、会话、令牌和改密标记一同回滚", async () => {
  connection.exec(
    "CREATE TRIGGER fail_audit BEFORE INSERT ON \"AuditLog\" BEGIN SELECT RAISE(ABORT, 'isolated failure'); END",
  );
  await expect(
    resetSuperAdminPassword(filename, "new-password-fixture", join(folder, "backups")),
  ).rejects.toThrow();
  expect(account().password).toBe(originalPassword);
  expect(user()).toEqual({
    role: "SUPER_ADMIN",
    status: "ACTIVE",
    emailVerified: 1,
    mustChangePassword: 0,
  });
  expect(connection.prepare('SELECT count(*) AS total FROM "Session"').get()).toEqual({ total: 2 });
  expect(connection.prepare('SELECT count(*) AS total FROM "Verification"').get()).toEqual({
    total: 3,
  });
});

test.each(["short", "x".repeat(129)])("拒绝不符合现有认证长度限制的密码", async (password) => {
  await expect(
    resetSuperAdminPassword(filename, password, join(folder, "backups")),
  ).rejects.toThrow("10–128");
  expect(account().password).toBe(originalPassword);
});

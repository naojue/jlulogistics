import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import path from "node:path";
import { mkdirSync } from "node:fs";

const globalDb = globalThis as unknown as { db?: PrismaClient };
export function databaseUrl() {
  const raw = process.env.DATABASE_URL || "file:./data/community.db";
  if (!raw.startsWith("file:")) throw new Error("本版本仅支持 SQLite file: 数据库地址");
  const file = path.resolve(raw.slice(5));
  mkdirSync(path.dirname(file), { recursive: true });
  return `file:${file.replaceAll("\\", "/")}`;
}
export const db =
  globalDb.db || new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl() }) });
if (process.env.NODE_ENV !== "production") globalDb.db = db;

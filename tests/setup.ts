import { beforeAll, afterAll } from "vitest";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import Database from "better-sqlite3";
mkdirSync("data", { recursive: true });
beforeAll(() => {
  const connection = new Database("data/test-unit.db");
  const tables = connection
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  connection.pragma("foreign_keys = OFF");
  for (const table of tables) connection.exec(`DROP TABLE "${table.name.replaceAll('"', '""')}"`);
  for (const folder of readdirSync("prisma/migrations")
    .filter((name) => /^\d/.test(name))
    .sort())
    connection.exec(readFileSync(`prisma/migrations/${folder}/migration.sql`, "utf8"));
  connection.pragma("foreign_keys = ON");
  connection.close();
});
afterAll(async () => {
  const { db } = await import("../src/lib/db");
  await db.$disconnect();
});

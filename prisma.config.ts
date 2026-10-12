import "dotenv/config";
import { defineConfig } from "prisma/config";
import path from "node:path";
const raw = process.env.DATABASE_URL || "file:./data/community.db";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: `file:${path.resolve(raw.slice(5)).replaceAll("\\", "/")}` },
});

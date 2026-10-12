import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { collectSourceFiles, readSourceFile } from "../scripts/source-files.mjs";

let temporary: string;
let project: string;
beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), "zhiye-source-export-"));
  project = join(temporary, "project");
  mkdirSync(project);
});
afterEach(() => {
  const parent = resolve(tmpdir());
  const target = resolve(temporary);
  if (
    !target.startsWith(parent + sep) ||
    !target.slice(parent.length + 1).startsWith("zhiye-source-export-")
  ) {
    throw new Error("Unsafe temporary cleanup path.");
  }
  rmSync(target, { recursive: true, force: true });
});
function write(file: string, contents = "fixture") {
  const target = join(project, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

test("public export keeps reproducible source while excluding local accounts, keys and live data", () => {
  for (const file of [
    "README.md",
    "LICENSE",
    ".env.example",
    ".github/workflows/ci.yml",
    "src/app/page.tsx",
    "prisma/migrations/1/migration.sql",
    "examples/demo.py",
  ])
    write(file);
  for (const file of [
    ".env",
    ".env.production",
    "data/community.db",
    "backups/snapshot/README.md",
    "releases/source.zip",
    "docs/design/ui-live/member.png",
    "docs/github-app.pem",
    "src/generated/client.ts",
    "public/vendor/pdfjs/pdf.mjs",
    "scripts/local.key",
    "next-env.d.ts",
    "docs/.ENV.production",
    "scripts/ID_RSA",
    "docs/.cache/state.json",
    "src/coverage/output.json",
    "scripts/test-results/results.json",
  ])
    write(file);
  expect(collectSourceFiles(project)).toEqual([
    ".env.example",
    ".github/workflows/ci.yml",
    "LICENSE",
    "README.md",
    "examples/demo.py",
    "prisma/migrations/1/migration.sql",
    "src/app/page.tsx",
  ]);
  write("README.md", "title\r\nbody\r\n");
  expect(readSourceFile(project, "README.md").toString()).toBe("title\nbody\n");
  expect(() => readSourceFile(project, ".env")).toThrow("allowlist");
  expect(() => readSourceFile(project, "../outside.md")).toThrow("allowlist");
});

test("source export rejects a credential accidentally pasted into documentation without echoing it", () => {
  const syntheticToken = "ghp_" + "a".repeat(40);
  write("docs/notes.md", syntheticToken);
  let message = "";
  try {
    readSourceFile(project, "docs/notes.md");
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toContain("docs/notes.md");
  expect(message).not.toContain(syntheticToken);
  expect(message).toContain("credential");
});

test("source export cannot follow a mounted directory into files outside the project", () => {
  const outside = join(temporary, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "notes.md"), "outside project");
  mkdirSync(join(project, "docs"));
  symlinkSync(outside, join(project, "docs", "mounted"), "junction");
  expect(() => collectSourceFiles(project)).toThrow("symbolic links");
  expect(() => readSourceFile(project, "docs/mounted/notes.md")).toThrow("symbolic links");
  write("data/notes.md", "private fixture");
  symlinkSync(join(project, "data"), join(project, "docs", "internal-mounted"), "junction");
  expect(() => readSourceFile(project, "docs/internal-mounted/notes.md")).toThrow("symbolic links");
});

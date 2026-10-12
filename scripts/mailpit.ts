import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
const binary = path.resolve(".tools", process.platform === "win32" ? "mailpit.exe" : "mailpit");
if (!existsSync(binary)) {
  mkdirSync(".tools", { recursive: true });
  console.error(
    "请将 Mailpit 程序放到 " +
      binary +
      "，下载地址：https://github.com/axllent/mailpit/releases\n也可以将 .env 的 SMTP 配置改为已有邮件服务。",
  );
  process.exit(1);
}
const child = spawn(binary, ["--listen", "127.0.0.1:8025", "--smtp", "127.0.0.1:1025"], {
  stdio: "inherit",
  windowsHide: true,
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code || 0));

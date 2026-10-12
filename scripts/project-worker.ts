import "dotenv/config";
import { runProjectWorkerOnce } from "../src/services/project-worker";
import { db } from "../src/lib/db";
let stopped = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopped = true;
  });
async function main() {
  while (!stopped) {
    try {
      await runProjectWorkerOnce();
    } catch {
      console.error("项目同步服务暂时失败，将自动重试。");
    }
    if (!stopped) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  await db.$disconnect();
}
void main().catch(() => {
  console.error("项目同步服务启动失败。");
  process.exitCode = 1;
});

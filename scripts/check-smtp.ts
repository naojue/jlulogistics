import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { verifySmtpConnection } from "../src/lib/mail";

async function checkSmtp() {
  config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
  const result = await verifySmtpConnection();
  if (result.ok) {
    console.log("SMTP 连接与认证通过。此检查没有发送邮件，也不能确认邮件已进入收件箱。");
    return;
  }
  console.error(
    `SMTP 检查失败：${result.code}${result.responseCode === undefined ? "" : ` / ${result.responseCode}`}`,
  );
  console.error(result.hint);
  process.exitCode = 1;
}

checkSmtp().catch(() => {
  console.error("SMTP 检查未完成，请检查运行环境与邮件配置；未输出配置或原始错误。");
  process.exitCode = 1;
});

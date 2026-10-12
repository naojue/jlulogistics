import nodemailer from "nodemailer";

const smtpErrorCodes = new Set([
  "EAUTH",
  "ECONNECTION",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ESOCKET",
  "ENOTFOUND",
  "EDNS",
  "EENVELOPE",
  "EMESSAGE",
  "ETLS",
  "EPROTOCOL",
]);

export type SmtpFailure = {
  code: string;
  responseCode?: number;
  hint: string;
};

/** Never include raw SMTP responses, recipients, message text, credentials or URLs. */
export function summarizeSmtpFailure(error: unknown): SmtpFailure {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code =
    typeof record.code === "string" && smtpErrorCodes.has(record.code) ? record.code : "UNKNOWN";
  const responseCode =
    typeof record.responseCode === "number" &&
    Number.isInteger(record.responseCode) &&
    record.responseCode >= 400 &&
    record.responseCode <= 599
      ? record.responseCode
      : undefined;
  const hint =
    code === "EAUTH" || responseCode === 535
      ? "SMTP 认证失败：QQ 邮箱请使用完整邮箱作为用户名，并重新生成授权码填入 SMTP_PASSWORD；不要使用邮箱登录密码。"
      : [
            "ECONNECTION",
            "ECONNREFUSED",
            "ECONNRESET",
            "ETIMEDOUT",
            "ESOCKET",
            "ENOTFOUND",
            "EDNS",
          ].includes(code)
        ? "SMTP 连接失败：检查服务器网络、SMTP_HOST、SMTP_PORT 和 SMTP_SECURE；QQ 邮箱通常使用 smtp.qq.com、465 和 true。"
        : code === "ETLS"
          ? "SMTP 加密连接失败：检查端口与 SMTP_SECURE 是否匹配，以及服务器时间；不要关闭证书校验。"
          : ["EENVELOPE", "EMESSAGE"].includes(code) || [550, 553, 554].includes(responseCode ?? 0)
            ? "SMTP 拒绝邮件：检查 MAIL_FROM 是否与发送账号一致，以及收件地址和邮箱发送限制。"
            : "SMTP 检查失败：核对邮件配置后重试；本检查不输出凭证或原始服务器响应。";
  return { code, ...(responseCode === undefined ? {} : { responseCode }), hint };
}

class MailDeliveryError extends Error {
  readonly code: string;
  readonly responseCode?: number;

  constructor(failure: SmtpFailure) {
    super(failure.hint);
    this.name = "MailDeliveryError";
    this.code = failure.code;
    this.responseCode = failure.responseCode;
  }
}

function createSmtpTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "127.0.0.1",
    port: Number(process.env.SMTP_PORT || 1025),
    secure: process.env.SMTP_SECURE === "true",
    ...(process.env.SMTP_USER
      ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }
      : {}),
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    logger: false,
    debug: false,
  });
}

function closeTransport(transport: ReturnType<typeof createSmtpTransport> | undefined) {
  // Cleanup errors must not overwrite a sanitized result or expose raw transport data.
  try {
    transport?.close();
  } catch {}
}

/** Connects and authenticates only. SMTP acceptance and inbox delivery are not tested. */
export async function verifySmtpConnection(): Promise<
  { ok: true } | ({ ok: false } & SmtpFailure)
> {
  let transport: ReturnType<typeof createSmtpTransport> | undefined;
  try {
    transport = createSmtpTransport();
    await transport.verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, ...summarizeSmtpFailure(error) };
  } finally {
    closeTransport(transport);
  }
}

export async function sendMail(to: string, subject: string, text: string) {
  let transport: ReturnType<typeof createSmtpTransport> | undefined;
  try {
    transport = createSmtpTransport();
    await transport.sendMail({
      from: process.env.MAIL_FROM || "学习资料社区 <community@example.test>",
      to,
      subject,
      text,
    });
  } catch (error) {
    const failure = summarizeSmtpFailure(error);
    console.error(
      `[SMTP] send failed code=${failure.code}${failure.responseCode === undefined ? "" : ` responseCode=${failure.responseCode}`}`,
    );
    // Better Auth may log the thrown error. Do not propagate the original error/cause.
    throw new MailDeliveryError(failure);
  } finally {
    closeTransport(transport);
  }
}

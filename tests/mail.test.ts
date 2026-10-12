import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { sendMail, summarizeSmtpFailure, verifySmtpConnection } from "../src/lib/mail";

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  verify: vi.fn(),
  close: vi.fn(),
}));
vi.mock("nodemailer", () => ({ default: { createTransport: mocks.createTransport } }));

beforeEach(() => {
  mocks.createTransport.mockReset();
  mocks.sendMail.mockReset().mockResolvedValue({ accepted: ["member@example.test"] });
  mocks.verify.mockReset().mockResolvedValue(true);
  mocks.close.mockReset();
  mocks.createTransport.mockReturnValue({
    sendMail: mocks.sendMail,
    verify: mocks.verify,
    close: mocks.close,
  });
  vi.stubEnv("SMTP_HOST", "smtp.example.test");
  vi.stubEnv("SMTP_PORT", "465");
  vi.stubEnv("SMTP_SECURE", "true");
  vi.stubEnv("SMTP_USER", "sender@example.test");
  vi.stubEnv("SMTP_PASSWORD", "fake-authorization-code");
  vi.stubEnv("MAIL_FROM", "学习社区 <sender@example.test>");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("SMTP verification connects and authenticates without sending a message", async () => {
  expect(await verifySmtpConnection()).toEqual({ ok: true });
  expect(mocks.verify).toHaveBeenCalledTimes(1);
  expect(mocks.sendMail).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledTimes(1);
  expect(mocks.createTransport).toHaveBeenCalledWith(
    expect.objectContaining({
      host: "smtp.example.test",
      port: 465,
      secure: true,
      auth: { user: "sender@example.test", pass: "fake-authorization-code" },
      logger: false,
      debug: false,
    }),
  );
});

test("SMTP auth diagnosis contains only allowlisted fields and fixed guidance", async () => {
  mocks.verify.mockRejectedValue(
    Object.assign(new Error("fake-secret https://example.test/reset?token=fake-token"), {
      code: "EAUTH",
      responseCode: 535,
      response: "password=fake-secret sender@example.test fake-token",
      command: "AUTH fake-authorization-code",
    }),
  );
  const result = await verifySmtpConnection();
  expect(result).toEqual({
    ok: false,
    code: "EAUTH",
    responseCode: 535,
    hint: expect.stringContaining("授权码"),
  });
  expect(JSON.stringify(result)).not.toMatch(/fake-secret|fake-token|sender@example|https:/);
  expect(mocks.close).toHaveBeenCalledTimes(1);
});

test("unrecognized error data and out-of-range status cannot appear in diagnosis", () => {
  const result = summarizeSmtpFailure({
    code: "password=fake-secret\nINJECTED",
    responseCode: "535 password=fake-secret",
    message: "fake-token",
  });
  expect(result.code).toBe("UNKNOWN");
  expect(result.responseCode).toBeUndefined();
  expect(JSON.stringify(result)).not.toMatch(/fake-secret|fake-token|INJECTED/);
  for (const responseCode of [NaN, 0, 200, 600, 535.5])
    expect(summarizeSmtpFailure({ responseCode }).responseCode).toBeUndefined();
});

test("sending mail strips original error and cause before upstream logging", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.sendMail.mockRejectedValue(
    Object.assign(new Error("fake-secret reset-token=raw-token"), {
      code: "EAUTH",
      responseCode: 535,
      response: "fake-authorization-code sender@example.test raw-token",
    }),
  );
  let failure: unknown;
  try {
    await sendMail("member@example.test", "重置密码", "https://example.test/reset?token=raw-token");
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure).toMatchObject({ name: "MailDeliveryError", code: "EAUTH", responseCode: 535 });
  expect(failure).not.toHaveProperty("cause");
  expect(`${JSON.stringify(failure)} ${(failure as Error).stack}`).not.toMatch(
    /fake-secret|raw-token|fake-authorization-code|sender@example/,
  );
  expect(log).toHaveBeenCalledWith("[SMTP] send failed code=EAUTH responseCode=535");
  expect(mocks.close).toHaveBeenCalledTimes(1);
});

test("successful sending preserves recipient and text, and closes transport", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await sendMail("member@example.test", "测试邮件", "邮件正文");
  expect(mocks.sendMail).toHaveBeenCalledWith({
    from: "学习社区 <sender@example.test>",
    to: "member@example.test",
    subject: "测试邮件",
    text: "邮件正文",
  });
  expect(mocks.close).toHaveBeenCalledTimes(1);
  expect(log).not.toHaveBeenCalled();
});

test("connection errors get actionable guidance and transport creation failures are sanitized", async () => {
  expect(summarizeSmtpFailure({ code: "ECONNREFUSED" }).hint).toContain("SMTP_PORT");
  expect(summarizeSmtpFailure({ code: "ETLS" }).hint).toContain("不要关闭证书校验");
  expect(summarizeSmtpFailure({ code: "EENVELOPE", responseCode: 553 }).hint).toContain(
    "MAIL_FROM",
  );
  mocks.createTransport.mockImplementation(() => {
    throw new Error("password=fake-secret");
  });
  expect(await verifySmtpConnection()).toEqual({
    ok: false,
    code: "UNKNOWN",
    hint: expect.stringContaining("核对邮件配置"),
  });
  expect(mocks.sendMail).not.toHaveBeenCalled();
});

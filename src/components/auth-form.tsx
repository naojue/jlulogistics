"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
export function AuthForm({
  mode,
  invite = "",
  email = "",
  token = "",
}: {
  mode: "login" | "register" | "forgot" | "reset" | "password";
  invite?: string;
  email?: string;
  token?: string;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [savedEmail, setSavedEmail] = useState(email);
  const router = useRouter();
  async function resend() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: savedEmail, callbackURL: "/login?verified=1" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "邮件发送失败");
      setMessage("验证邮件已发送，请检查收件箱。");
    } catch (error) {
      setError(error instanceof Error ? error.message : "发送失败");
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="form-stack auth-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        const element = event.currentTarget;
        const form = new FormData(element);
        setPending(true);
        setError("");
        setMessage("");
        const values = Object.fromEntries(form) as Record<string, string>;
        setSavedEmail(values.email || savedEmail);
        const endpoint =
          mode === "register"
            ? "/api/account/register"
            : `/api/auth/${({ login: "sign-in/email", forgot: "request-password-reset", reset: "reset-password", password: "change-password" } as const)[mode]}`;
        const body =
          mode === "register"
            ? { ...values, invite: values.invite || undefined }
            : mode === "forgot"
              ? { email: values.email, redirectTo: "/reset-password" }
              : mode === "reset"
                ? { token, newPassword: values.newPassword }
                : mode === "password"
                  ? {
                      currentPassword: values.currentPassword,
                      newPassword: values.newPassword,
                      revokeOtherSessions: true,
                    }
                  : { email: values.email, password: values.password, rememberMe: true };
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await response.json();
          if (!response.ok) {
            const messages: Record<string, string> = {
              INVALID_EMAIL_OR_PASSWORD: "邮箱或密码不正确",
              EMAIL_NOT_VERIFIED: "请先验证邮箱，再登录社区",
              PASSWORD_TOO_SHORT: "密码至少需要 10 位",
              PASSWORD_TOO_LONG: "密码不能超过 128 位",
              INVALID_PASSWORD: "当前密码不正确",
              INVALID_TOKEN: "链接无效或已过期，请重新申请",
              TOKEN_EXPIRED: "链接已过期，请重新申请",
              USER_NOT_FOUND: "账号不存在，请检查邮箱",
              FAILED_TO_CREATE_USER: "注册未完成，请稍后重试",
              INVALID_EMAIL: "请输入有效邮箱",
            };
            const raw = typeof data.error === "string" ? data.error : data.message;
            throw new Error(
              response.status === 429
                ? "操作过于频繁，请稍后重试"
                : messages[data.code] ||
                    (typeof raw === "string" && /[\u3400-\u9fff]/.test(raw)
                      ? raw
                      : "操作未完成，请检查输入或稍后重试"),
            );
          }
          if (mode === "login") {
            router.push("/account");
            router.refresh();
          }
          if (mode === "register")
            setMessage("注册申请已提交，请先打开邮件验证邮箱。验证后登录查看申请状态。");
          if (mode === "forgot")
            setMessage("如果该邮箱已注册，你将收到重置密码邮件。请检查收件箱。");
          if (mode === "reset") {
            element.reset();
            setMessage("密码已重置，请重新登录。");
            router.refresh();
          }
          if (mode === "password") {
            element.reset();
            setMessage("密码已修改，其他设备上的会话已失效。");
            router.refresh();
          }
        } catch (error) {
          setError(error instanceof Error ? error.message : "连接失败，请稍后重试");
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending}>
        {["login", "register", "forgot"].includes(mode) && (
          <label>
            邮箱
            <input
              name="email"
              type="email"
              defaultValue={email}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>
        )}
        {mode === "register" && (
          <label>
            昵称
            <input
              name="name"
              required
              minLength={2}
              maxLength={30}
              placeholder="大家如何称呼你"
              autoComplete="nickname"
            />
          </label>
        )}
        {["login", "register"].includes(mode) && (
          <label>
            密码
            <input
              name="password"
              type="password"
              required
              minLength={mode === "register" ? 10 : 1}
              maxLength={128}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              placeholder={mode === "register" ? "至少 10 位，建议混合字母与数字" : "输入你的密码"}
            />
          </label>
        )}
        {mode === "register" && (
          <>
            <label>
              申请说明
              <textarea
                name="statement"
                required
                minLength={10}
                maxLength={1000}
                rows={3}
                defaultValue={invite ? "受邀加入学习社区管理团队" : ""}
                placeholder="介绍你来自哪里，以及想学习什么（至少 10 个字）"
              />
            </label>
            <details open={!!invite}>
              <summary>我有管理员邀请码</summary>
              <label>
                管理员邀请码
                <input
                  name="invite"
                  defaultValue={invite}
                  maxLength={100}
                  placeholder="普通成员注册无需邀请码"
                  autoComplete="off"
                />
              </label>
            </details>
          </>
        )}
        {mode === "password" && (
          <label>
            当前密码
            <input
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
        )}
        {["password", "reset"].includes(mode) && (
          <label>
            新密码
            <input
              name="newPassword"
              type="password"
              required
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              placeholder="至少 10 位"
            />
          </label>
        )}
        <Button className="full-width" disabled={pending || (mode === "reset" && !token)}>
          {pending ? <LoaderCircle size={16} className="spin" /> : null}
          {
            (
              {
                login: "登录社区",
                register: "提交注册申请",
                forgot: "发送重置邮件",
                reset: "设置新密码",
                password: "修改密码",
              } as const
            )[mode]
          }
          <ArrowRight size={16} />
        </Button>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="form-success" role="status">
          {message}
        </p>
      )}
      {["register", "login"].includes(mode) && savedEmail && (
        <button type="button" className="text-link" disabled={pending} onClick={resend}>
          没有收到验证邮件？重新发送
        </button>
      )}
      {mode === "login" && (
        <div className="auth-links">
          <Link href="/register">申请加入社区</Link>
          <Link href="/forgot-password">忘记密码</Link>
        </div>
      )}
      {mode !== "login" && mode !== "password" && (
        <p className="muted center">
          已有账号？
          <Link className="text-link" href="/login">
            前往登录
          </Link>
        </p>
      )}
    </form>
  );
}

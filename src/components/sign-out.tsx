"use client";
import { useState } from "react";
import { LoaderCircle, LogOut } from "lucide-react";
import styles from "./sign-out.module.css";
export function SignOut() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        // Reload server-rendered identity and discard cached authenticated routes.
        window.location.replace("/");
        return;
      }
      setError(response.status === 429 ? "操作过于频繁，请稍后再试。" : "退出失败，请稍后重试。");
    } catch {
      setError("网络连接失败，请稍后重试。");
    }
    setPending(false);
  }

  return (
    <div className={styles.control}>
      <button
        type="button"
        className="icon-button"
        title={pending ? "正在退出登录" : "退出登录"}
        aria-label={pending ? "正在退出登录" : "退出登录"}
        aria-busy={pending}
        disabled={pending}
        onClick={signOut}
      >
        {pending ? <LoaderCircle size={18} className="spin" /> : <LogOut size={18} />}
      </button>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

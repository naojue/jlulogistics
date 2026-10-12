"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/app/actions";
export function ActionForm({
  action,
  children,
  className = "form-stack",
  reset = false,
  redirectBase,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  reset?: boolean;
  redirectBase?: string;
}) {
  const [result, setResult] = useState<ActionResult>({});
  const [pending, setPending] = useState(false);
  const router = useRouter();
  return (
    <form
      className={className}
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        const element = event.currentTarget;
        const form = new FormData(element, (event.nativeEvent as SubmitEvent).submitter);
        setPending(true);
        setResult({});
        try {
          const response = await action(form);
          setResult(response);
          if (!response.error) {
            if (reset) element.reset();
            if (redirectBase && response.id) router.push(redirectBase + response.id);
            router.refresh();
          }
        } catch {
          setResult({ error: "连接失败，请稍后重试" });
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending}>{children}</fieldset>
      {pending && (
        <p className="form-feedback" role="status">
          正在提交…
        </p>
      )}
      {result.error && (
        <p className="form-error" role="alert">
          {result.error}
        </p>
      )}
      {result.success && (
        <p className="form-success" role="status">
          {result.success}
        </p>
      )}
      {result.token && (
        <div className="invitation-result">
          <label>
            邀请码（仅本次显示）
            <input readOnly value={result.token} onFocus={(event) => event.target.select()} />
          </label>
          <label>
            邀请链接
            <input readOnly value={result.url} onFocus={(event) => event.target.select()} />
          </label>
        </div>
      )}
    </form>
  );
}

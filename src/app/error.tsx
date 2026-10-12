"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state">
      <h2>暂时无法加载内容</h2>
      <p className="muted">请稍后重试。如果持续出现，请联系管理员。</p>
      <Button onClick={reset}>重新加载</Button>
    </div>
  );
}

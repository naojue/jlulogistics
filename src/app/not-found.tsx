import { EmptyState } from "@/components/common";
export default function NotFound() {
  return (
    <EmptyState
      title="这页内容已经不在这里了"
      description="内容可能已被删除，或你没有访问权限。"
      href="/"
      label="返回资料库"
    />
  );
}

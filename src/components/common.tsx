import Link from "next/link";
import { ArrowRight, FileText, BookOpen, FolderOpen, ShieldCheck } from "lucide-react";
import { date, fileSize } from "@/lib/utils";
import { Button } from "@/components/ui/button";
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function EmptyState({
  title = "这里还没有内容",
  description = "新的分享，会从这里开始。",
  href,
  label,
}: {
  title?: string;
  description?: string;
  href?: string;
  label?: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <FolderOpen size={29} />
      </div>
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      {href && (
        <Button asChild variant="outline">
          <Link href={href}>
            {label || "开始分享"}
            <ArrowRight size={16} />
          </Link>
        </Button>
      )}
    </div>
  );
}
export type ResourceItem = {
  id: string;
  title: string;
  description: string;
  area: string;
  createdAt: Date;
  category: { name: string };
  tags: { id: string; name: string }[];
  author: { name: string };
  file: { name: string; size: number };
  attachments: { file: { size: number } }[];
};
export function ResourceCard({ item }: { item: ResourceItem }) {
  const ext = item.file.name.split(".").at(-1)?.toUpperCase() || "FILE";
  return (
    <Link className="resource-card" href={`/resources/${item.id}`}>
      <div className="resource-card-top">
        <div className={`file-icon file-${ext.toLowerCase()}`}>
          <FileText size={25} />
          <span>{ext}</span>
        </div>
        <span className={`badge ${item.area === "ADMIN" ? "badge-admin" : "badge-member"}`}>
          {item.area === "ADMIN" ? <ShieldCheck size={12} /> : <BookOpen size={12} />}
          {item.area === "ADMIN" ? "管理员资料" : "成员分享"}
        </span>
      </div>
      <div className="category-label">{item.category.name}</div>
      <h3>{item.title}</h3>
      <p className="card-description">{item.description}</p>
      <div className="tag-list">
        {item.tags.slice(0, 3).map((tag) => (
          <span className="tag" key={tag.id}>
            {tag.name}
          </span>
        ))}
      </div>
      <div className="resource-card-footer">
        <span className="avatar avatar-small">{item.author.name.slice(0, 1)}</span>
        <span>{item.author.name}</span>
        <span className="push-right">
          {item.attachments.length ? `${item.attachments.length + 1} 张图片 · ` : ""}
          {fileSize(
            item.file.size +
              item.attachments.reduce((total, attachment) => total + attachment.file.size, 0),
          )}
        </span>
      </div>
      <div className="resource-card-date">
        {date(item.createdAt)}
        <ArrowRight size={15} />
      </div>
    </Link>
  );
}
export function Pagination({
  page,
  pages,
  base,
  query = {},
}: {
  page: number;
  pages: number;
  base: string;
  query?: Record<string, string | undefined>;
}) {
  if (pages < 2) return null;
  const href = (number: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
    params.set("page", String(number));
    return `${base}?${params}`;
  };
  return (
    <nav className="pagination" aria-label="分页">
      {page > 1 ? <Link href={href(page - 1)}>上一页</Link> : <span>上一页</span>}
      <span>
        第 {page} / {pages} 页
      </span>
      {page < pages ? <Link href={href(page + 1)}>下一页</Link> : <span>下一页</span>}
    </nav>
  );
}

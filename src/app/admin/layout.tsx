import Link from "next/link";
import { memberPage } from "@/lib/session";
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await memberPage(true);
  return (
    <>
      <nav className="admin-nav" aria-label="管理导航">
        <Link href="/admin">管理概览</Link>
        <Link href="/admin/members">成员审批</Link>
        <Link href="/admin/resources">资料管理</Link>
        <Link href="/admin/projects">项目管理</Link>
        <Link href="/admin/discussions">讨论管理</Link>
        <Link href="/admin/taxonomy">分类与标签</Link>
        <Link href="/admin/logs">操作记录</Link>
        {user.role === "SUPER_ADMIN" && <Link href="/admin/administrators">管理员与邀请</Link>}
      </nav>
      {children}
    </>
  );
}

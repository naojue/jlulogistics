import type { Metadata } from "next";
import Link from "next/link";
import { Network, ArrowUpRight } from "lucide-react";
import { currentUser } from "@/lib/session";
import { Navigation } from "@/components/navigation";
import { SignOut } from "@/components/sign-out";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/brand";
import { ThemeSwitcher } from "@/components/theme-switcher";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "吉大物流 · 学习社区", template: "%s · 吉大物流" },
  description: "连接物流与供应链知识，分享资料，与同学共同成长。",
};
export const dynamic = "force-dynamic";
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const admin =
    !!user &&
    user.status === "ACTIVE" &&
    ["ADMIN", "SUPER_ADMIN"].includes(user.role) &&
    !user.mustChangePassword;
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script src="/theme-init.js" />
      </head>
      <body>
        <a href="#main" className="skip-link">
          跳转到主要内容
        </a>
        <div className="app-shell">
          <aside className="sidebar">
            <Brand />
            <div className="sidebar-label">学习空间</div>
            <Navigation admin={admin} />
            <div className="sidebar-note">
              <Network size={23} strokeWidth={1.5} />
              <h3>让知识连接更多可能</h3>
              <p>从课堂笔记到行业洞察，与物流伙伴一起积累、一起成长。</p>
              <Link href="/upload">
                分享一份资料 <ArrowUpRight size={15} />
              </Link>
            </div>
            <div className="sidebar-bottom">
              <span className="status-dot" />
              吉大物流 · 共同成长
            </div>
          </aside>
          <div className="main-shell">
            <header className="topbar">
              <span className="topbar-label">
                <span className="status-dot" /> 连接知识 · 共享成长
              </span>
              <div className="topbar-actions">
                <ThemeSwitcher />
                {user ? (
                  <>
                    <Link className="user-menu" href="/account">
                      <span className="avatar">{user.name.slice(0, 1)}</span>
                      <span>{user.name}</span>
                    </Link>
                    <SignOut />
                  </>
                ) : (
                  <>
                    <Link className="login-link" href="/login">
                      登录
                    </Link>
                    <Button asChild size="sm">
                      <Link href="/register">
                        加入社区 <ArrowUpRight size={15} />
                      </Link>
                    </Button>
                  </>
                )}
              </div>
            </header>
            <main id="main" className="main-content">
              {children}
            </main>
            <footer className="site-footer">
              <span>吉大物流 · 每一份分享，都有新的可能</span>
              <span>物流与供应链学习社区</span>
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}

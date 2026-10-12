"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LibraryBig,
  MessagesSquare,
  Upload,
  UserRound,
  ShieldCheck,
  ArrowUpRight,
  Code2,
} from "lucide-react";
import { cn } from "@/lib/utils";
export function Navigation({ admin }: { admin: boolean }) {
  const path = usePathname();
  const links = [
    { href: "/", label: "资料库", icon: LibraryBig },
    { href: "/projects", label: "专业项目库", icon: Code2 },
    { href: "/forum", label: "讨论广场", icon: MessagesSquare },
    { href: "/upload", label: "上传资料", icon: Upload },
    { href: "/account", label: "我的空间", icon: UserRound },
    ...(admin ? [{ href: "/admin", label: "管理后台", icon: ShieldCheck }] : []),
  ];
  return (
    <nav className="main-nav" aria-label="主导航">
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={
            (href === "/" ? path === "/" || path.startsWith("/resources") : path.startsWith(href))
              ? "page"
              : undefined
          }
          className={cn(
            "nav-item",
            (href === "/"
              ? path === "/" || path.startsWith("/resources")
              : path.startsWith(href)) && "active",
          )}
        >
          <Icon size={19} />
          <span>{label}</span>
          {path === href && <ArrowUpRight size={14} className="nav-arrow" />}
        </Link>
      ))}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Brain,
  ClipboardCheck,
  History,
  House,
  LayoutDashboard,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from "lucide-react";

export const workspaceNavItems = [
  { label: "首页", href: "/", icon: House },
  { label: "选品体检", href: "/products/new", icon: LayoutDashboard },
  { label: "素材接收", href: "/materials", icon: UploadCloud },
  { label: "爆款拆解", href: "/viral", icon: Sparkles },
  { label: "货源判断", href: "/sourcing", icon: ClipboardCheck },
  { label: "风险排查", href: "/risk", icon: ShieldCheck },
  { label: "小白结论", href: "/summary", icon: Brain },
  { label: "任务记录", href: "/tasks", icon: History },
] as const;

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function WorkspaceSidebar() {
  const pathname = usePathname() || "/";

  return (
    <aside className="hidden lg:block">
      <div className="sticky top-3 space-y-3">
        <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-sky-500 text-white shadow-sm">
            <Sparkles className="h-5 w-5" />
          </div>
          <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-950">轻选 Agent</h1>
          <p className="mt-1 text-xs leading-5 text-slate-500">清爽版选品工作台</p>
        </div>
        <nav className="rounded-[28px] border border-white/80 bg-white/90 p-2 shadow-[0_18px_50px_rgba(15,23,42,0.05)]" aria-label="工作台导航">
          {workspaceNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={"mb-1 flex h-11 w-full items-center gap-3 rounded-2xl px-3 text-sm font-medium transition last:mb-0 " + (active ? "bg-teal-600 text-white shadow-sm" : "text-slate-600 hover:bg-teal-50 hover:text-teal-800")}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

export function WorkspaceMobileNav() {
  const pathname = usePathname() || "/";

  return (
    <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="工作台移动导航">
      {workspaceNavItems.map((item) => {
        const Icon = item.icon;
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={"inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-medium " + (active ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600")}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

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
      <div className="sticky top-4 flex flex-col gap-3">
        <div className="surface-card rounded-[32px] p-5">
          <div className="glass-panel rounded-[26px] p-1.5">
            <div className="premium-inner flex min-h-[112px] flex-col justify-between rounded-[21px] p-4">
              <div className="icon-glass size-12 rounded-2xl">
                <Sparkles className="size-5" />
              </div>
              <div>
                <p className="mt-5 text-[10px] font-black uppercase tracking-[0.18em] text-teal-700">Local Agent</p>
                <h1 className="section-title mt-1 text-2xl">轻选 Agent</h1>
                <p className="muted-text mt-1 text-xs leading-5">本地优先的选品工作台</p>
              </div>
            </div>
          </div>
        </div>
        <nav className="surface-card rounded-[32px] p-2.5" aria-label="工作台导航">
          {workspaceNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={"premium-button mb-1 flex h-12 w-full items-center gap-3 rounded-[22px] px-3 text-sm font-bold last:mb-0 " + (active ? "glass-nav-active" : "text-slate-600 hover:bg-emerald-50/70 hover:text-emerald-800")}
              >
                <span className={"flex size-8 items-center justify-center rounded-2xl " + (active ? "bg-white/75 text-emerald-700 shadow-sm" : "bg-white/75 text-slate-500 shadow-sm")}>
                  <Icon className="size-4" />
                </span>
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
    <nav className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="工作台移动导航">
      {workspaceNavItems.map((item) => {
        const Icon = item.icon;
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={"premium-button inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-bold " + (active ? "glass-nav-active" : "border-white/80 bg-white/80 text-slate-600 shadow-sm")}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

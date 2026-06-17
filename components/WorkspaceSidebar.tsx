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
  { label: "货源判断", href: "/sourcing", icon: ClipboardCheck, step: 1 },
  { label: "风险排查", href: "/risk", icon: ShieldCheck, step: 2 },
  { label: "选品体检", href: "/products/new", icon: LayoutDashboard, step: 3 },
  { label: "爆款拆解", href: "/viral", icon: Sparkles, step: 4 },
  { label: "任务记录", href: "/tasks", icon: History, step: 5 },
  { label: "首页", href: "/", icon: House },
] as const;

const navGroups = [
  {
    title: "选品工作流",
    items: workspaceNavItems.slice(0, 5),
  },
  {
    title: "高级工具",
    items: workspaceNavItems.slice(5, 6),
  },
] as const;

const plannedItems = [
  { label: "素材接收", icon: UploadCloud },
  { label: "小白结论", icon: Brain },
  { label: "关键词 Agent", icon: null },
  { label: "AI 生图 Agent", icon: null },
  { label: "AI 生视频 Agent", icon: null },
  { label: "发布 Agent", icon: null },
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
        <div className="surface-card p-3">
          <div className="flex items-start gap-3">
            <div className="linear-icon size-9 shrink-0 rounded-xl">
                <Sparkles className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-teal-700">1代半自动</p>
              <h1 className="section-title mt-0.5 truncate text-lg">轻选 Agent</h1>
              <p className="muted-text mt-1 text-xs leading-5">本地优先，人工确认</p>
            </div>
          </div>
        </div>

        <nav className="surface-card p-2" aria-label="工作台导航">
          {navGroups.map((group) => (
            <div key={group.title} className="mb-3 last:mb-0">
              <p className="px-2 pb-1 text-[11px] font-semibold text-slate-400">{group.title}</p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActivePath(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={"mb-1 flex h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-sm font-medium transition last:mb-0 " + (active ? "linear-nav-active" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950")}
                  >
                    <span className={"flex size-7 items-center justify-center rounded-lg border " + (active ? "border-teal-200 bg-white text-teal-700" : "border-slate-200 bg-white text-slate-500")}>
                      {"step" in item && item.step ? (
                        <span className="text-[11px] font-bold">{item.step}</span>
                      ) : (
                        <Icon className="size-4" />
                      )}
                    </span>
                    {item.label}
                    {"step" in item && item.step ? (
                      <span className="ml-auto text-[10px] font-medium text-slate-400">Step {item.step}</span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="surface-card-soft p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-slate-500">规划中</p>
            <span className="linear-pill px-2 py-0.5 text-[11px] text-slate-500">后期接入</span>
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {plannedItems.map((item) => (
              <div key={item.label} className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-500">
                <span className="status-dot status-dot-slate" />
                {item.label}
              </div>
            ))}
          </div>
        </div>
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
            className={"inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition " + (active ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600")}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

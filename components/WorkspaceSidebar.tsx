"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Brain,
  ClipboardCheck,
  Compass,
  History,
  House,
  LayoutDashboard,
  ListChecks,
  Package,
  ShieldCheck,
  Sparkles,
  Target,
  UploadCloud,
} from "lucide-react";
import { useSharedProduct } from "@/hooks/useSharedProduct";

export const workspaceNavItems = [
  { label: "机会雷达", href: "/opportunities", icon: Target },
  { label: "批量分析", href: "/workflow/batch", icon: ListChecks },
  { label: "单品分析", href: "/workflow", icon: LayoutDashboard },
  { label: "Agent 路线图", href: "/agent", icon: Compass },
  { label: "任务中心", href: "/tasks", icon: History },
  { label: "货源判断", href: "/sourcing", icon: ClipboardCheck },
  { label: "风险排查", href: "/risk", icon: ShieldCheck },
  { label: "小白结论", href: "/summary", icon: Brain },
  { label: "爆款拆解", href: "/viral", icon: Sparkles },
  { label: "新品体检", href: "/products/new", icon: Package },
  { label: "素材接收", href: "/materials", icon: UploadCloud },
] as const;

const homeItem = { label: "首页", href: "/", icon: House } as const;

const navGroups = [
  {
    title: "核心流程",
    items: workspaceNavItems.slice(0, 5),
  },
  {
    title: "辅助工具",
    items: workspaceNavItems.slice(5),
  },
] as const;

const plannedItems = [
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
  const [sharedProduct] = useSharedProduct();

  return (
    <aside className="hidden lg:block">
      <div className="sticky top-4 flex flex-col gap-3">
        {/* 当前选品指示器 */}
        {sharedProduct.productName ? (
          <div className="surface-card rounded-2xl border-teal-200 bg-teal-50/60 p-3">
            <div className="flex items-center gap-2">
              <Package className="size-4 shrink-0 text-teal-600" />
              <p className="text-[11px] font-semibold text-teal-600">当前选品</p>
            </div>
            <p className="mt-1 truncate text-sm font-bold text-teal-900">{sharedProduct.productName}</p>
            <p className="mt-0.5 text-xs text-teal-600">
              {sharedProduct.targetPlatform}
              {sharedProduct.category ? ` · ${sharedProduct.category}` : ""}
            </p>
          </div>
        ) : null}

        <div className="surface-card p-3">
          <div className="flex items-start gap-3">
            <div className="linear-icon size-9 shrink-0 rounded-xl">
                <Sparkles className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-teal-700">全自动 Agent Alpha</p>
              <p className="section-title mt-0.5 truncate text-lg font-semibold">轻选 Agent</p>
              <p className="muted-text mt-1 text-xs leading-5">受控自动化，人工复核</p>
            </div>
          </div>
        </div>

        {/* 首页独立入口 */}
        <Link
          href={homeItem.href}
          aria-current={isActivePath(pathname, homeItem.href) ? "page" : undefined}
          className={"surface-card flex h-11 items-center gap-2.5 rounded-xl px-3 text-sm font-semibold transition " + (isActivePath(pathname, homeItem.href) ? "linear-nav-active" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950")}
        >
          <span className={"flex size-7 items-center justify-center rounded-lg border " + (isActivePath(pathname, homeItem.href) ? "border-teal-200 bg-white text-teal-700" : "border-slate-200 bg-white text-slate-500")}>
            <homeItem.icon className="size-4" />
          </span>
          {homeItem.label}
        </Link>

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
                      <Icon className="size-4" />
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="surface-card-soft p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-slate-500">后续能力预留</p>
            <span className="linear-pill px-2 py-0.5 text-[11px] text-slate-500">未上线</span>
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

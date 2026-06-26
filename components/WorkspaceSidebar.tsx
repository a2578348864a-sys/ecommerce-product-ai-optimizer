"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  History,
  House,
  ListChecks,
  Package,
  Sparkles,
  Target,
} from "lucide-react";
import { useSharedProduct } from "@/hooks/useSharedProduct";
import { DemoAccessBanner } from "@/components/DemoAccessBanner";

export const workspaceNavItems = [
  { label: "工作台", href: "/", icon: House },
  { label: "找机会", href: "/opportunities", icon: Target },
  { label: "单品分析", href: "/workflow", icon: Sparkles },
  { label: "任务中心", href: "/tasks", icon: History },
  { label: "批量分析", href: "/workflow/batch", icon: ListChecks },
] as const;

const mobileNavItems = workspaceNavItems;

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/agent") return pathname === "/agent";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLink({
  item,
  pathname,
  compact = false,
}: {
  item: (typeof workspaceNavItems)[number];
  pathname: string;
  compact?: boolean;
}) {
  const Icon = item.icon;
  const active = isActivePath(pathname, item.href);

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={
        (compact
          ? "mb-1 flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm font-medium transition last:mb-0 "
          : "mb-1 flex h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-sm font-medium transition last:mb-0 ") +
        (active ? "linear-nav-active" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950")
      }
    >
      <span
        className={
          "flex items-center justify-center rounded-lg border bg-white " +
          (compact ? "size-6 " : "size-7 ") +
          (active ? "border-teal-200 text-teal-700" : "border-slate-200 text-slate-500")
        }
      >
        <Icon className={compact ? "size-3.5" : "size-4"} />
      </span>
      {item.label}
    </Link>
  );
}

export function WorkspaceSidebar() {
  const pathname = usePathname() || "/";
  const [sharedProduct] = useSharedProduct();

  return (
    <>
      <DemoAccessBanner />
      <aside className="hidden lg:block">
        <div className="sticky top-4 flex flex-col gap-3">
          {sharedProduct.productName ? (
          <div className="surface-card rounded-2xl border-teal-200 bg-teal-50/60 p-3">
            <div className="flex items-center gap-2">
              <Package className="size-4 shrink-0 text-teal-600" />
              <p className="text-xs font-semibold text-teal-600">当前选品</p>
            </div>
            <p className="mt-1 truncate text-sm font-bold text-teal-900">{sharedProduct.productName}</p>
            <p className="mt-0.5 text-xs text-teal-600">
              {sharedProduct.targetPlatform}
              {sharedProduct.category ? ` / ${sharedProduct.category}` : ""}
            </p>
          </div>
        ) : null}

        <div className="surface-card p-3">
          <div className="flex items-start gap-3">
            <div className="linear-icon size-9 shrink-0 rounded-xl">
              <Sparkles className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-teal-700">受控自动化 · 人工复核版</p>
              <p className="section-title mt-0.5 truncate text-lg font-semibold">轻选 Agent</p>
              <p className="muted-text mt-1 text-sm leading-6">先分析，再人工复核</p>
            </div>
          </div>
        </div>

        <nav className="surface-card p-2" aria-label="工作台导航">
          <p className="px-2 pb-1 text-xs font-semibold text-slate-400">主链路</p>
          {workspaceNavItems.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
      </div>
    </aside>
    </>
  );
}

export function WorkspaceMobileNav() {
  const pathname = usePathname() || "/";

  return (
    <nav className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="工作台移动导航">
      {mobileNavItems.map((item) => {
        const Icon = item.icon;
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              "inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition " +
              (active ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600")
            }
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
